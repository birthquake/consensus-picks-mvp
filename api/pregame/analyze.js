// FILE LOCATION: api/pregame/analyze.js
// Pre-game prop pick generator.
// Unlike halftime analysis (which uses live box scores), this works entirely
// from historical data + contextual factors:
//   - Last 5, last 10, season averages per stat
//   - Variance (std dev) over last 10 → determines cushion on threshold
//   - Back-to-back detection (days since last game)
//   - Home/away split averages
//   - Opponent defensive rating vs position/stat
//   - Rest-adjusted and opponent-adjusted projection
//   - Directional factors → threshold and star rating
//
// Usage: POST /api/pregame/analyze
// Body: { gameId, sport, league, homeTeam, awayTeam, gameDate, existingLegs?, legCount? }

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STAT_KEYS = ['points', 'rebounds', 'assists', 'steals', 'blocks'];

// Regression weight per stat (how much to pull current trend toward season avg)
const REGRESSION_WEIGHT = { points: 0.40, rebounds: 0.30, assists: 0.30, steals: 0.25, blocks: 0.25 };

// Variance thresholds → cushion in stat units
const VARIANCE_CUSHION = {
  points:   { low: [0, 4,  2], mid: [4, 8,  4], high: [8, 999, 6] },
  rebounds: { low: [0, 2,  1], mid: [2, 4,  2], high: [4, 999, 3] },
  assists:  { low: [0, 2,  1], mid: [2, 4,  2], high: [4, 999, 3] },
  steals:   { low: [0, 1, 0.5],mid: [1, 2,  1], high: [2, 999, 1.5] },
  blocks:   { low: [0, 1, 0.5],mid: [1, 2,  1], high: [2, 999, 1.5] },
};

async function fetchWithTimeout(url, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ─── Schedule / roster ────────────────────────────────────────────────────────

async function getGameRoster(sport, league, gameId) {
  // Pull the pre-game summary to get projected starters / roster
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${gameId}`;
  const data = await fetchWithTimeout(url, 6000);
  if (!data) return null;

  // Pre-game summaries have rosters in data.rosters or data.leaders
  // Fall back to fetching team rosters directly
  const competitors = data.header?.competitions?.[0]?.competitors || [];
  const teams = competitors.map(c => ({
    id: c.team?.id,
    abbreviation: c.team?.abbreviation,
    displayName: c.team?.displayName,
    homeAway: c.homeAway,
  }));

  return { teams, rawSummary: data };
}

async function getTeamRoster(sport, league, teamId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/roster`;
  const data = await fetchWithTimeout(url, 5000);
  if (!data) return [];

  const players = [];
  const groups = data.athletes || [];
  for (const group of groups) {
    const items = group.items || group.athletes || [];
    for (const p of items) {
      players.push({
        id: p.id,
        name: p.displayName,
        position: p.position?.abbreviation,
        jersey: p.jersey,
      });
    }
  }
  return players;
}

// ─── Historical form ──────────────────────────────────────────────────────────

async function getHistoricalForm(sport, league, athleteId, gameDate) {
  const base = new Date(gameDate);
  const dates = Array.from({ length: 25 }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() - (i + 1));
    return formatDate(d);
  });

  const responses = await Promise.all(
    dates.map(dateStr =>
      fetchWithTimeout(
        `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${dateStr}`,
        3000
      ).catch(() => null)
    )
  );

  const recentGameIds = [];
  const gameDateMap = {}; // gameId → date string
  for (let i = 0; i < responses.length; i++) {
    const data = responses[i];
    if (!data?.events) continue;
    for (const event of data.events) {
      if (event.status?.type?.completed) {
        recentGameIds.push(event.id);
        gameDateMap[event.id] = dates[i];
      }
    }
  }

  if (recentGameIds.length === 0) return null;

  const formData = { byGame: [], gameDates: {} };
  const BATCH = 8;

  for (let i = 0; i < recentGameIds.length && formData.byGame.length < 10; i += BATCH) {
    const batch = recentGameIds.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(gameId => extractPlayerGameLine(sport, league, gameId, athleteId, gameDateMap[gameId]))
    );
    for (const r of batchResults) {
      if (r && formData.byGame.length < 10) {
        formData.byGame.push(r);
        formData.gameDates[r.gameId] = r.date;
      }
    }
  }

  if (formData.byGame.length === 0) return null;

  const calc = (games, stat) => {
    const vals = games.map(g => g.stats[stat]).filter(v => v != null && !isNaN(v));
    if (vals.length === 0) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };

  const stdDev = (games, stat) => {
    const vals = games.map(g => g.stats[stat]).filter(v => v != null && !isNaN(v));
    if (vals.length < 2) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length;
    return Math.round(Math.sqrt(variance) * 10) / 10;
  };

  const last5  = formData.byGame.slice(0, 5);
  const last10 = formData.byGame.slice(0, 10);

  formData.averages = {
    last5:  Object.fromEntries(STAT_KEYS.map(s => [s, calc(last5, s)])),
    last10: Object.fromEntries(STAT_KEYS.map(s => [s, calc(last10, s)])),
  };

  formData.stdDev = Object.fromEntries(STAT_KEYS.map(s => [s, stdDev(last10, s)]));
  formData.floor  = Object.fromEntries(STAT_KEYS.map(s => {
    const vals = last10.map(g => g.stats[s]).filter(v => v != null);
    return [s, vals.length > 0 ? Math.min(...vals) : null];
  }));
  formData.ceiling = Object.fromEntries(STAT_KEYS.map(s => {
    const vals = last10.map(g => g.stats[s]).filter(v => v != null);
    return [s, vals.length > 0 ? Math.max(...vals) : null];
  }));

  // Trend: last 3 vs games 4-10
  const last3 = formData.byGame.slice(0, 3);
  const older = formData.byGame.slice(3, 10);
  formData.trends = {};
  for (const stat of STAT_KEYS) {
    const r = calc(last3, stat);
    const o = calc(older, stat);
    if (r == null || o == null || o === 0) { formData.trends[stat] = 'neutral'; continue; }
    if (r > o * 1.15) formData.trends[stat] = 'up';
    else if (r < o * 0.85) formData.trends[stat] = 'down';
    else formData.trends[stat] = 'neutral';
  }

  // Home/away splits
  formData.homeAvg = Object.fromEntries(STAT_KEYS.map(s => [s, calc(formData.byGame.filter(g => g.isHome), s)]));
  formData.awayAvg = Object.fromEntries(STAT_KEYS.map(s => [s, calc(formData.byGame.filter(g => !g.isHome), s)]));

  // Days since last game (rest)
  if (formData.byGame.length > 0) {
    const lastGameDate = formData.byGame[0].date;
    if (lastGameDate) {
      const daysSinceLastGame = Math.floor(
        (new Date(gameDate) - new Date(lastGameDate)) / 86400000
      );
      formData.daysSinceLastGame = daysSinceLastGame;
      formData.isBackToBack = daysSinceLastGame <= 1;
    }
  }

  return formData;
}

async function extractPlayerGameLine(sport, league, gameId, athleteId, date) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${gameId}`;
    const summary = await fetchWithTimeout(url, 4000);
    if (!summary?.boxscore?.players) return null;

    for (const group of summary.boxscore.players) {
      const statsBlock = group.statistics?.[0];
      if (!statsBlock) continue;
      const keys = statsBlock.keys || [];
      const athlete = (statsBlock.athletes || []).find(a => String(a.athlete?.id) === String(athleteId));
      if (!athlete?.stats?.length) continue;

      const stats = {};
      for (const stat of STAT_KEYS) {
        const idx = keys.findIndex(k => k === stat || k.startsWith(stat));
        if (idx >= 0) {
          const val = parseStatValue(String(athlete.stats[idx] ?? ''));
          if (val != null) stats[stat] = val;
        }
      }

      const minutesIdx = keys.indexOf('minutes');
      const minutes = minutesIdx >= 0 ? parseFloat(athlete.stats[minutesIdx]) || 0 : 0;
      if (minutes < 5 && !Object.keys(stats).length) return null;

      // Determine home/away for this game
      const competitors = summary.header?.competitions?.[0]?.competitors || [];
      const playerTeamId = group.team?.id;
      const isHome = competitors.find(c => String(c.team?.id) === String(playerTeamId))?.homeAway === 'home';

      return { gameId, date, stats, minutes, isHome };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Season averages ──────────────────────────────────────────────────────────

async function getSeasonAverages(sport, league, athleteId) {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/${sport}/${league}/athletes/${athleteId}/overview`;
  const data = await fetchWithTimeout(url, 4000);
  if (!data) return null;

  const stats = data.athlete?.statistics || data.statistics;
  if (!stats) return null;

  const result = {};
  const splits = stats.splits?.categories || stats.categories || [];
  for (const cat of splits) {
    for (const s of (cat.stats || [])) {
      const name  = s.name?.toLowerCase();
      const abbr  = s.abbreviation?.toLowerCase();
      const val   = parseFloat(s.displayValue ?? s.value);
      if (isNaN(val)) continue;
      if (name === 'avgpoints'   || abbr === 'ppg') result.points   = val;
      if (name === 'avgrebounds' || abbr === 'rpg') result.rebounds = val;
      if (name === 'avgassists'  || abbr === 'apg') result.assists  = val;
      if (name === 'avgminutes'  || abbr === 'mpg') result.minutes  = val;
      if (name === 'fieldgoalspct' || abbr === 'fg%') result.fgPct  = val;
      if (name === 'avgsteals'   || abbr === 'spg') result.steals   = val;
      if (name === 'avgblocks'   || abbr === 'bpg') result.blocks   = val;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

// ─── Opponent defensive rating ────────────────────────────────────────────────

async function getOpponentDefenseRating(sport, league, opponentTeamId, stat) {
  // Fetch opponent's team stats to see how many pts/reb/ast they allow per game
  // We compare to league average to get a rating
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${opponentTeamId}`;
    const data = await fetchWithTimeout(url, 4000);
    if (!data) return null;

    // Also fetch standings which has defensive ratings
    const standingsUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/standings`;
    const standings = await fetchWithTimeout(standingsUrl, 4000);

    // For now return a qualitative rating based on team record
    // A future enhancement would pull actual defensive stats per position
    const team = data.team;
    if (!team) return null;

    return {
      teamName: team.displayName,
      teamAbbrev: team.abbreviation,
      // Placeholder — real defensive ratings need a separate stats endpoint
      available: false,
    };
  } catch {
    return null;
  }
}

// ─── Projection engine ────────────────────────────────────────────────────────

function buildPreGameProjection(player, seasonAvg, historicalForm, isHome, opponentRating) {
  const projections = {};

  for (const stat of STAT_KEYS) {
    const last5  = historicalForm?.averages?.last5?.[stat];
    const last10 = historicalForm?.averages?.last10?.[stat];
    const season = seasonAvg?.[stat];
    const sd     = historicalForm?.stdDev?.[stat];
    const floor  = historicalForm?.floor?.[stat];
    const ceil   = historicalForm?.ceiling?.[stat];
    const trend  = historicalForm?.trends?.[stat] || 'neutral';
    const homeAvg = historicalForm?.homeAvg?.[stat];
    const awayAvg = historicalForm?.awayAvg?.[stat];
    const isBackToBack = historicalForm?.isBackToBack || false;
    const daysSince = historicalForm?.daysSinceLastGame ?? 2;

    if (last10 == null && season == null) continue;

    // Base projection: weighted blend of last5, last10, season
    const base = last5 != null && last10 != null && season != null
      ? (last5 * 0.40) + (last10 * 0.35) + (season * 0.25)
      : last10 ?? season ?? last5 ?? 0;

    // Home/away adjustment
    let locationAdj = 0;
    if (isHome && homeAvg != null && last10 != null) {
      locationAdj = (homeAvg - last10) * 0.5; // partial weight
    } else if (!isHome && awayAvg != null && last10 != null) {
      locationAdj = (awayAvg - last10) * 0.5;
    }

    // Rest adjustment
    let restAdj = 0;
    if (isBackToBack) {
      // Back-to-back typically drops output ~8-12% for counting stats
      restAdj = -(base * 0.10);
    } else if (daysSince >= 3) {
      // Well rested — slight positive
      restAdj = base * 0.03;
    }

    // Trend adjustment
    let trendAdj = 0;
    if (trend === 'up'   && last5 != null && last10 != null) trendAdj =  (last5 - last10) * 0.3;
    if (trend === 'down' && last5 != null && last10 != null) trendAdj =  (last5 - last10) * 0.3;

    // Final blended projection
    const blended = Math.round((base + locationAdj + restAdj + trendAdj) * 10) / 10;

    // Variance-based cushion
    const cushionConfig = VARIANCE_CUSHION[stat];
    let cushion = 3; // default
    if (cushionConfig && sd != null) {
      if      (sd < cushionConfig.low[1])  cushion = cushionConfig.low[2];
      else if (sd < cushionConfig.mid[1])  cushion = cushionConfig.mid[2];
      else                                  cushion = cushionConfig.high[2];
    }

    // Additional cushion adjustments
    if (isBackToBack) cushion += 1;          // more uncertainty on B2B
    if (trend === 'up') cushion -= 0.5;      // trending hot → tighter cushion OK
    if (trend === 'down') cushion += 0.5;    // trending cold → more buffer

    // Suggested threshold (round to nearest 0.5)
    const rawThreshold = blended - cushion;
    const threshold = Math.round(rawThreshold * 2) / 2;

    // Edge: how far above threshold the projection sits
    const edge = Math.round((blended - threshold) * 10) / 10;

    // Floor check: is suggested threshold below their worst game in last 10?
    const belowFloor = floor != null && threshold <= floor;

    projections[stat] = {
      last5, last10, season,
      blended,
      threshold,
      cushion: Math.round(cushion * 10) / 10,
      edge,
      stdDev: sd,
      floor,
      ceiling: ceil,
      trend,
      isBackToBack,
      daysSinceLastGame: daysSince,
      locationAdj: Math.round(locationAdj * 10) / 10,
      restAdj:     Math.round(restAdj * 10) / 10,
      trendAdj:    Math.round(trendAdj * 10) / 10,
      belowFloor,  // true = extremely strong pick
      isHome,
    };
  }

  return projections;
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

async function generatePreGamePicks(game, playerData, existingLegs, legCount) {
  const playerLines = playerData.map(p => {
    const proj = p.projections;
    if (!proj || Object.keys(proj).length === 0) return null;

    const lines = [`${p.team} | ${p.name} (${p.position ?? '?'})`];

    for (const stat of STAT_KEYS) {
      const s = proj[stat];
      if (!s || s.blended == null) continue;

      const trendIcon = s.trend === 'up' ? '📈' : s.trend === 'down' ? '📉' : '➡️';
      const b2bFlag   = s.isBackToBack ? ' ⚠️ BACK-TO-BACK' : '';
      const floorFlag = s.belowFloor ? ' 🔒 BELOW 10-GAME FLOOR' : '';
      const location  = s.isHome ? 'HOME' : 'AWAY';

      lines.push(
        `  ${stat.toUpperCase()}:${b2bFlag}${floorFlag}
    Projection: ${s.blended} (L5=${s.last5 ?? '?'} L10=${s.last10 ?? '?'} Season=${s.season ?? '?'})
    Suggested threshold: Over ${s.threshold} | Cushion: ${s.cushion} | Edge: ${s.edge}
    Variance (std dev): ${s.stdDev ?? '?'} | Floor: ${s.floor ?? '?'} | Ceiling: ${s.ceiling ?? '?'}
    Trend: ${trendIcon} ${s.trend} | ${location} | Rest: ${s.daysSinceLastGame ?? '?'}d since last game
    Adjustments: location ${s.locationAdj > 0 ? '+' : ''}${s.locationAdj} | rest ${s.restAdj > 0 ? '+' : ''}${s.restAdj} | trend ${s.trendAdj > 0 ? '+' : ''}${s.trendAdj}`
      );
    }

    return lines.join('\n');
  }).filter(Boolean).join('\n\n');

  const existingLegsText = existingLegs.length > 0
    ? `\nEXISTING LEGS (exclude these players):\n${existingLegs.map((l, i) => `${i + 1}. ${l.player} - ${l.stat}`).join('\n')}\n`
    : '';

  const prompt = `You are an expert sports bettor generating pre-game prop pick recommendations. You have detailed historical projections for each player including variance-adjusted thresholds, trend data, rest factors, and home/away splits.

GAME: ${game.awayTeam?.name ?? 'Away'} @ ${game.homeTeam?.name ?? 'Home'}
TIPOFF: ${game.gameDate}
${existingLegsText}

PLAYER PROJECTIONS (pre-game, no live box score available):
${playerLines}

HOW TO USE THESE PROJECTIONS:

THRESHOLD LOGIC:
- "Suggested threshold" = blended projection minus variance cushion
- A larger cushion means higher variance player — threshold is conservative on purpose
- "BELOW 10-GAME FLOOR" = extremely strong pick — player hasn't gone this low in 10 games
- "Edge" = how many units of cushion between projection and threshold

RATING FRAMEWORK (1-5 stars):
5 stars: projection well above threshold + trending up + good rest + below floor flag
4 stars: projection above threshold + at least 2 positive factors aligned
3 stars: projection above threshold + mixed signals
2 stars: projection above threshold but back-to-back OR high variance OR trending down
1 star: only marginal edge or significant risk flags

FACTORS TO WEIGH:
- Back-to-back (⚠️): significant risk — drop rating by 1 star minimum
- Below floor (🔒): extremely strong signal — raise rating, mention explicitly in rationale
- Trend up (📈) + good rest (3+ days): strong combination
- High std dev with small edge: risky — mention in risk_flags
- Away game for a player with significant home/away split: note explicitly
- If L5 avg is significantly above L10: player is hot, weight threshold closer to L5

For each pick provide:
- player: exact full name
- team: team abbreviation
- stat: one of "Points", "Rebounds", "Assists", "Steals", "Blocks"
- direction: always "Over" for pre-game recommendations (we back players to perform)
- threshold: the exact number to bet Over on (use the suggested threshold from the data)
- projection: the blended projection number
- edge: cushion between projection and threshold
- rationale: 2-3 sentences citing SPECIFIC numbers — projection, threshold, trend, rest
- rating: 1-5 stars
- rating_reason: one sentence explaining the rating
- risk_flags: array of concern strings (empty if clean)

Return ONLY valid JSON, no markdown:
{
  "game_summary": "2-3 sentences on the matchup and what to watch",
  "picks": [
    {
      "player": "Full Name",
      "team": "ABV",
      "stat": "Points",
      "direction": "Over",
      "threshold": 24.5,
      "projection": 29.2,
      "edge": 4.7,
      "rationale": "...",
      "rating": 4,
      "rating_reason": "...",
      "risk_flags": []
    }
  ]
}

Recommend exactly ${legCount} picks if ${legCount} strong options exist. Never pad with weak picks. Prioritize picks where multiple factors align — below-floor flags, clean rest, positive trend, and meaningful edge all pointing the same direction.`;

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(raw);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameId, sport, league, homeTeam, awayTeam, gameDate, existingLegs, legCount = 4 } = req.body;

  if (!gameId || !sport || !league) {
    return res.status(400).json({ error: 'Missing required fields: gameId, sport, league' });
  }

  try {
    console.log(`[pregame/analyze] Analyzing ${gameId} (${league.toUpperCase()})`);

    // Step 1: Get rosters for both teams
    const [homeRoster, awayRoster] = await Promise.all([
      homeTeam?.id ? getTeamRoster(sport, league, homeTeam.id) : [],
      awayTeam?.id ? getTeamRoster(sport, league, awayTeam.id) : [],
    ]);

    // Tag players with home/away and limit to likely rotation players
    // Cap at 8 per team (16 total) to stay within time budget
    const homePlayers = homeRoster.slice(0, 8).map(p => ({ ...p, isHome: true,  teamAbbrev: homeTeam?.abbreviation }));
    const awayPlayers = awayRoster.slice(0, 8).map(p => ({ ...p, isHome: false, teamAbbrev: awayTeam?.abbreviation }));
    const allPlayers  = [...homePlayers, ...awayPlayers];

    console.log(`[pregame/analyze] Analyzing ${allPlayers.length} players`);

    // Step 2: Fetch historical form + season averages in parallel
    const [formResults, seasonResults] = await Promise.all([
      Promise.all(allPlayers.map(p => getHistoricalForm(sport, league, p.id, gameDate).catch(() => null))),
      Promise.all(allPlayers.map(p => getSeasonAverages(sport, league, p.id).catch(() => null))),
    ]);

    // Step 3: Build projections, filter to players with enough data
    const playerData = allPlayers.map((p, i) => {
      const form   = formResults[i];
      const season = seasonResults[i];
      if (!form && !season) return null;

      const projections = buildPreGameProjection(p, season, form, p.isHome, null);
      if (Object.keys(projections).length === 0) return null;

      return {
        id:          p.id,
        name:        p.name,
        position:    p.position,
        team:        p.teamAbbrev,
        isHome:      p.isHome,
        projections,
        form,
        season,
      };
    }).filter(Boolean);

    console.log(`[pregame/analyze] Built projections for ${playerData.length} players`);

    if (playerData.length === 0) {
      return res.status(404).json({ error: 'Could not build projections for any players in this game' });
    }

    // Step 4: Claude analysis
    const picks = await generatePreGamePicks(
      { homeTeam, awayTeam, gameDate },
      playerData,
      existingLegs || [],
      legCount,
    );

    return res.status(200).json({
      success: true,
      gameId,
      game: { homeTeam, awayTeam, sport, league, gameDate },
      ...picks,
      player_count: playerData.length,
      analyzed_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[pregame/analyze] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseStatValue(raw) {
  if (!raw || raw === '--' || raw === '-') return null;
  const s = String(raw).trim();
  if (s.includes('-') && !s.startsWith('-')) return parseInt(s.split('-')[0], 10) || null;
  if (s.startsWith('+')) return parseFloat(s.slice(1)) || null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}
