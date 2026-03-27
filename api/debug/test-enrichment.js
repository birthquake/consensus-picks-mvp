// FILE LOCATION: api/debug/test-enrichment.js
// Combined debug endpoint for testing both enrichment and pre-game data pipeline.
//
// Enrichment test:
//   GET /api/debug/test-enrichment?player=Shai+Gilgeous-Alexander&stat=Points&sport=NBA&date=2026-03-21
//
// Pre-game pipeline test:
//   GET /api/debug/test-enrichment?mode=pregame&sport=basketball&league=nba

import { enrichPicks, formatEnrichmentForPrompt } from '../../lib/espn-enrichment.js';

async function fetchWithTimeout(url, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { _error: `HTTP ${res.status}`, _url: url };
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    return { _error: e.message, _url: url };
  }
}

function formatDate(d) {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const mode = req.query.mode || 'enrichment';

  // ── Pre-game pipeline debug ──────────────────────────────────────────────
  if (mode === 'pregame') {
    const sport  = req.query.sport  || 'basketball';
    const league = req.query.league || 'nba';
    const steps  = {};

    const today = formatDate(new Date());
    const sbUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${today}`;
    const sbData = await fetchWithTimeout(sbUrl);

    steps.scoreboard = {
      url: sbUrl,
      event_count: sbData?.events?.length || 0,
      error: sbData?._error || null,
      games: (sbData?.events || []).slice(0, 5).map(e => ({
        id: e.id,
        name: e.shortName,
        state: e.competitions?.[0]?.status?.type?.state,
        competitors: (e.competitions?.[0]?.competitors || []).map(c => ({
          homeAway: c.homeAway,
          teamId: c.team?.id,
          abbrev: c.team?.abbreviation,
        })),
      })),
    };

    const game = sbData?.events?.find(e => e.competitions?.[0]?.status?.type?.state === 'pre')
      || sbData?.events?.[0];

    if (!game) return res.status(200).json({ steps, error: 'No games found' });

    const competitors = game.competitions?.[0]?.competitors || [];
    const homeComp = competitors.find(c => c.homeAway === 'home');
    const homeId   = homeComp?.team?.id;

    steps.chosen_game = { id: game.id, name: game.shortName, homeId, homeAbbrev: homeComp?.team?.abbreviation };

    if (homeId) {
      const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${homeId}/roster`;
      const rosterData = await fetchWithTimeout(rosterUrl);
      const athletes = rosterData?.athletes || [];
      // Handle both flat array (each element is a player) and grouped array
      const isFlat = athletes.length > 0 && (athletes[0].id || athletes[0].fullName);
      const players = [];
      if (isFlat) {
        for (const p of athletes) {
          if (p.id) players.push({ id: p.id, name: p.displayName || p.fullName, pos: p.position?.abbreviation });
        }
      } else {
        for (const g of athletes) {
          const items = g.items || g.athletes || [];
          players.push(...items.map(p => ({ id: p.id, name: p.displayName, pos: p.position?.abbreviation })));
        }
      }
      steps.roster = {
        url: rosterUrl,
        is_flat_array: isFlat,
        player_count: players.length,
        sample_players: players.slice(0, 5),
        top_level_keys: rosterData ? Object.keys(rosterData) : [],
        error: rosterData?._error || null,
      };
    }

    // Recent game IDs (3 days)
    const dates = [1,2,3].map(i => { const d = new Date(); d.setDate(d.getDate()-i); return formatDate(d); });
    const sbResponses = await Promise.all(dates.map(ds =>
      fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${ds}`, 3000).catch(() => null)
    ));
    const recentIds = [];
    for (const d of sbResponses) {
      if (!d?.events) continue;
      for (const e of d.events) if (e.status?.type?.completed) recentIds.push(e.id);
    }
    steps.recent_game_ids = { days_checked: 3, games_found: recentIds.length, sample: recentIds.slice(0, 5) };

    // Test season averages endpoints for first player
    if (steps.roster?.sample_players?.length > 0) {
      const p = steps.roster.sample_players[0];

      // Test multiple stat endpoint patterns to find which one works
      const endpointTests = [
        { key: 'stats_0',    url: `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/athletes/${p.id}/statistics/0` },
        { key: 'stats_base', url: `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/athletes/${p.id}/statistics` },
        { key: 'core_stats', url: `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/seasons/2026/athletes/${p.id}/statistics/0` },
        { key: 'overview',   url: `https://site.web.api.espn.com/apis/common/v3/sports/${sport}/${league}/athletes/${p.id}/overview` },
        { key: 'gamelog',    url: `https://site.web.api.espn.com/apis/common/v3/sports/${sport}/${league}/athletes/${p.id}/gamelog` },
        { key: 'gamelog_star', url: `https://site.web.api.espn.com/apis/common/v3/sports/${sport}/${league}/athletes/${p.id}/gamelog` },
      ];

      const endpointResults = await Promise.all(
        endpointTests.map(async ({ key, url }) => {
          const data = await fetchWithTimeout(url);
          return {
            key, url,
            status: data?._error ? 'error' : 'ok',
            error: data?._error || null,
            top_level_keys: data && !data._error ? Object.keys(data) : [],
            // Look for any stats-like keys
            has_splits: !!(data?.splits),
            has_categories: !!(data?.categories || data?.splits?.categories),
            has_statistics: !!(data?.statistics || data?.athlete?.statistics),
            categories_count: data?.splits?.categories?.length || data?.categories?.length || 0,
            // Show first stat item if any categories found
            first_stat: (() => {
              const cats = data?.splits?.categories || data?.categories || [];
              const firstCat = cats[0];
              const firstStat = firstCat?.stats?.[0];
              return firstStat ? { name: firstStat.name, abbr: firstStat.abbreviation, val: firstStat.displayValue } : null;
            })(),
            raw_100: JSON.stringify(data || {}).substring(0, 200),
            // For overview: show full statistics shape
            gamelog_shape: key === 'gamelog' ? (() => {
              const events = data?.events || {};
              const eventKeys = Object.keys(events);
              const firstEventId = eventKeys[0];
              const firstEvent = events[firstEventId] || {};
              // Check if stats are stored as parallel arrays under data.statistics
              // or inside each event
              const topLevelStats = data?.statistics || [];
              const firstStatBlock = topLevelStats[0] || {};
              return {
                labels: data?.labels || [],
                names: data?.names || [],
                events_count: eventKeys.length,
                first_event_id: firstEventId,
                first_event_keys: Object.keys(firstEvent),
                first_event_full: JSON.stringify(firstEvent).substring(0, 600),
                // Check top-level statistics array (parallel to events)
                top_level_stats_count: topLevelStats.length,
                first_stat_block_keys: Object.keys(firstStatBlock),
                first_stat_block_sample: JSON.stringify(firstStatBlock).substring(0, 400),
                // Check if data has a 'values' or 'rows' parallel to events
                has_values: !!(data?.values),
                has_rows: !!(data?.rows),
                values_sample: data?.values ? JSON.stringify(data.values).substring(0, 200) : null,
                // seasonTypes full structure
                season_types_full: JSON.stringify(data?.seasonTypes || []).substring(0, 600),
                // Check glossary for clues
                glossary_sample: JSON.stringify(data?.glossary || {}).substring(0, 200),
              };
            })() : null,
            overview_stats_shape: key === 'overview' ? {
              has_labels: !!(data?.statistics?.labels),
              has_names: !!(data?.statistics?.names),
              has_values: !!(data?.statistics?.values),
              labels: data?.statistics?.labels || [],
              names: data?.statistics?.names || [],
              values: data?.statistics?.values || [],
              // Parsed season averages attempt
              parsed_averages: (() => {
                const s = data?.statistics;
                if (!s?.names || !s?.values?.length) return 'no values array';
                const result = {};
                s.names.forEach((name, i) => {
                  const val = parseFloat(s.values[i]);
                  if (!isNaN(val)) result[name] = val;
                });
                return result;
              })(),
              has_gamelog: !!(data?.gameLog),
              gamelog_statistics_count: data?.gameLog?.statistics?.length || 0,
              gamelog_stat0_names: data?.gameLog?.statistics?.[0]?.names || [],
              gamelog_stat0_values: data?.gameLog?.statistics?.[0]?.values || [],
              gamelog_stat0_athletes_count: data?.gameLog?.statistics?.[0]?.athletes?.length || 0,
              gamelog_events_count: data?.gameLog?.events ? Object.keys(data.gameLog.events).length : 0,
            } : null,
          };
        })
      );

      steps.endpoint_tests = { player: p.name, player_id: p.id, results: endpointResults };
    }

    return res.status(200).json({ success: true, mode: 'pregame', steps });
  }

  // ── Duplicate pick cleanup ───────────────────────────────────────────────
  if (mode === 'cleanup') {
    // Finds and removes duplicate halftime_picks (same gameId + player + stat)
    // Keeps the most recently created pick, removes older duplicates
    const { initializeApp, cert, getApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');

    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
    let app;
    try { app = getApp(); } catch {
      app = initializeApp({ credential: cert(serviceAccount) });
    }
    const db = getFirestore(app);

    const snapshot = await db.collection('halftime_picks').get();
    const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Group by gameId + player + stat
    const groups = {};
    for (const pick of all) {
      const key = `${pick.gameId}:${pick.player}:${pick.stat}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(pick);
    }

    // Find duplicates — groups with more than one entry
    const toDelete = [];
    for (const [key, picks] of Object.entries(groups)) {
      if (picks.length <= 1) continue;
      // Sort by created_at descending — keep newest, delete rest
      picks.sort((a, b) => {
        const aTime = a.created_at?.seconds || 0;
        const bTime = b.created_at?.seconds || 0;
        return bTime - aTime;
      });
      // Keep picks[0], delete the rest
      for (const dupe of picks.slice(1)) {
        toDelete.push(dupe.id);
      }
    }

    // Delete in batches
    let deleted = 0;
    const BATCH_SIZE = 400;
    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const id of toDelete.slice(i, i + BATCH_SIZE)) {
        batch.delete(db.collection('halftime_picks').doc(id));
      }
      await batch.commit();
      deleted += Math.min(BATCH_SIZE, toDelete.length - i);
    }

    return res.status(200).json({
      success: true,
      mode: 'cleanup',
      total_picks: all.length,
      unique_picks: Object.keys(groups).length,
      duplicates_found: toDelete.length,
      deleted,
    });
  }

  // ── Enrichment debug (original) ──────────────────────────────────────────
  const { player, stat, sport, date, line } = req.query;

  if (!player || !stat || !sport) {
    return res.status(400).json({
      error: 'Missing params',
      usage_enrichment: '/api/debug/test-enrichment?player=Shai+Gilgeous-Alexander&stat=Points&sport=NBA&date=2026-03-21',
      usage_pregame: '/api/debug/test-enrichment?mode=pregame&sport=basketball&league=nba',
    });
  }

  const gameDate = date || new Date().toISOString().split('T')[0];
  const mockPick = { player, stat, sport, bet_type: 'Over', line: line ? parseFloat(line) : null };

  const start = Date.now();
  const enrichments = await enrichPicks([mockPick], gameDate);
  const elapsed = Date.now() - start;
  const e = enrichments[0];

  const checks = {
    athlete_found:   !!e.espnId,
    injury_found:    !!e.injuryStatus && e.injuryStatus !== 'Unknown',
    form_found:      !!(e.recentForm?.length > 0),
    form_has_values: !!(e.recentForm?.some(g => g.value !== null)),
    opponent_found:  !!e.opponent,
  };

  return res.status(200).json({
    success: true,
    mode: 'enrichment',
    input: { player, stat, sport, gameDate, line: mockPick.line },
    elapsed_ms: elapsed,
    checks,
    status: Object.values(checks).every(Boolean) ? '✅ All checks passed' : '⚠️ Some data missing',
    enrichment_result: {
      playerFullName: e.playerFullName || null,
      espnId:         e.espnId || null,
      injuryStatus:   e.injuryStatus || null,
      opponent:       e.opponent || null,
      recentForm:     e.recentForm || null,
      error:          e.error || null,
    },
    prompt_block: formatEnrichmentForPrompt(enrichments),
  });
}
