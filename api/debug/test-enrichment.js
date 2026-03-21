// FILE LOCATION: api/debug/test-enrichment.js
// Temporary debug endpoint — remove before production.
//
// Usage:
//   GET /api/debug/test-enrichment?player=Shai+Gilgeous-Alexander&stat=Points&sport=NBA&date=2026-03-21&line=28.5
//   GET /api/debug/test-enrichment?player=Connor+McDavid&stat=Goals&sport=NHL&date=2026-03-21
//   GET /api/debug/test-enrichment?player=Aaron+Judge&stat=Home+Runs&sport=MLB&date=2026-04-05

import { enrichPicks, formatEnrichmentForPrompt } from '../utils/espn-enrichment.js';

// Also import internals directly so we can test each step individually
const SPORT_CONFIG = {
  NFL:  { sport: 'football',   league: 'nfl' },
  NBA:  { sport: 'basketball', league: 'nba' },
  MLB:  { sport: 'baseball',   league: 'mlb' },
  NHL:  { sport: 'hockey',     league: 'nhl' },
};

async function fetchWithTimeout(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { _error: `HTTP ${res.status}`, url };
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    return { _error: e.message, url };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { player, stat, sport, date, line } = req.query;

  if (!player || !stat || !sport) {
    return res.status(400).json({
      error: 'Missing params',
      usage: '/api/debug/test-enrichment?player=Shai+Gilgeous-Alexander&stat=Points&sport=NBA&date=2026-03-21&line=28.5',
    });
  }

  const gameDate = date || new Date().toISOString().split('T')[0];
  const config = SPORT_CONFIG[sport.toUpperCase()];

  if (!config) {
    return res.status(400).json({ error: `Unknown sport: ${sport}` });
  }

  const steps = {};

  // ── Step 1: Teams endpoint ────────────────────────────────────────────────
  const teamsUrl = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/teams?limit=50`;
  const teamsData = await fetchWithTimeout(teamsUrl);
  const teamList = teamsData?.sports?.[0]?.leagues?.[0]?.teams || teamsData?.teams || [];
  steps.teams = {
    url: teamsUrl,
    team_count: teamList.length,
    error: teamsData?._error || null,
  };

  // ── Step 2: Sample roster (first team) ───────────────────────────────────
  const firstTeamId = teamList[0]?.team?.id || teamList[0]?.id;
  if (firstTeamId) {
    const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/teams/${firstTeamId}/roster`;
    const rosterData = await fetchWithTimeout(rosterUrl);
    const groups = rosterData?.athletes || [];
    const samplePlayers = [];
    for (const g of groups) {
      const items = g.items || g.athletes || [];
      samplePlayers.push(...items.slice(0, 2).map(p => ({
        id: p.id,
        displayName: p.displayName,
        uid: p.uid,
      })));
    }
    steps.sample_roster = {
      team_id: firstTeamId,
      url: rosterUrl,
      sample_players: samplePlayers.slice(0, 6),
      error: rosterData?._error || null,
    };
  }

  // ── Step 3: Full enrichment ───────────────────────────────────────────────
  const mockPick = {
    player,
    stat,
    sport,
    bet_type: 'Over',
    line: line ? parseFloat(line) : null,
  };

  const start = Date.now();
  const enrichments = await enrichPicks([mockPick], gameDate);
  const elapsed = Date.now() - start;
  const e = enrichments[0];

  // ── Step 4: Gamelog raw check (if we got an athlete ID) ───────────────────
  if (e.espnId) {
    const gamelogUrl = `https://sports.core.api.espn.com/v2/sports/${config.sport}/leagues/${config.league}/athletes/${e.espnId}/eventlog`;
    const gamelogData = await fetchWithTimeout(gamelogUrl);
    const items = gamelogData?.events?.items || gamelogData?.items || [];
    const sampleItem = items[items.length - 1] || null; // most recent
    steps.gamelog = {
      url: gamelogUrl,
      item_count: items.length,
      error: gamelogData?._error || null,
      top_level_keys: gamelogData ? Object.keys(gamelogData) : [],
      sample_item_keys: sampleItem ? Object.keys(sampleItem) : [],
      sample_item: sampleItem,
    };
  }

  // ── Build response ────────────────────────────────────────────────────────
  const checks = {
    athlete_found:    !!e.espnId,
    injury_found:     !!e.injuryStatus && e.injuryStatus !== 'Unknown',
    form_found:       !!(e.recentForm?.length > 0),
    form_has_values:  !!(e.recentForm?.some(g => g.value !== null)),
    opponent_found:   !!e.opponent,
    prompt_populated: (formatEnrichmentForPrompt(enrichments) || '').length > 50,
  };

  return res.status(200).json({
    input: { player, stat, sport, gameDate, line: mockPick.line },
    elapsed_ms: elapsed,
    checks,
    status: Object.values(checks).every(Boolean)
      ? '✅ All checks passed'
      : '⚠️ Some data missing — see steps for details',
    enrichment_result: {
      playerFullName: e.playerFullName || null,
      espnId: e.espnId || null,
      injuryStatus: e.injuryStatus || null,
      statKey: e.statKey || null,
      opponent: e.opponent || null,
      recentForm: e.recentForm || null,
      error: e.error || null,
    },
    prompt_block: formatEnrichmentForPrompt(enrichments),
    diagnostic_steps: steps,
  });
}
