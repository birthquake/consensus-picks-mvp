// FILE LOCATION: api/pregame/analyze-mlb.js
// MLB pre-game prop pick generator.
// Works from historical gamelog data for batters and pitchers:
//
// BATTERS:
//   - Season avg hits, total bases, home runs, RBI, runs, HRA (hits+runs+RBI)
//   - Last 5 game rolling averages for trend detection
//   - Variance (std dev) over season → determines cushion on threshold
//
// PITCHERS (SP only):
//   - Season avg strikeouts, outs recorded, walks per start
//   - Last 5 starts rolling averages
//   - Projected innings based on season avg
//
// Usage: POST /api/pregame/analyze-mlb
// Body: { gameId, sport, league, homeTeam, awayTeam, gameDate, existingLegs?, legCount? }

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Stat config ──────────────────────────────────────────────────────────────

const BATTER_STATS  = ['hits', 'totalBases', 'homeRuns', 'rbi', 'runs', 'hra'];
const PITCHER_STATS = ['strikeouts', 'outsRecorded', 'walks'];

const SPORTSBOOK_MINIMUMS = {
  hits:         0.5,
  totalBases:   1.5,
  homeRuns:     0.5,
  rbi:          0.5,
  runs:         0.5,
  hra:          2.5,
  strikeouts:   3.5,
  outsRecorded: 10.5,
  walks:        0.5,
};

const VARIANCE_CUSHION = {
  hits:         { low: [0, 0.5, 0.5], mid: [0.5, 1.0, 1.0], high: [1.0, 999, 1.5] },
  totalBases:   { low: [0, 0.8, 0.5], mid: [0.8, 1.5, 1.0], high: [1.5, 999, 2.0] },
  homeRuns:     { low: [0, 0.3, 0.5], mid: [0.3, 0.6, 0.5], high: [0.6, 999, 0.5] },
  rbi:          { low: [0, 0.5, 0.5], mid: [0.5, 1.0, 1.0], high: [1.0, 999, 1.5] },
  runs:         { low: [0, 0.5, 0.5], mid: [0.5, 1.0, 1.0], high: [1.0, 999, 1.5] },
  hra:          { low: [0, 1.0, 1.0], mid: [1.0, 2.0, 1.5], high: [2.0, 999, 2.5] },
  strikeouts:   { low: [0, 1.5, 1.0], mid: [1.5, 2.5, 1.5], high: [2.5, 999, 2.5] },
  outsRecorded: { low: [0, 3.0, 2.0], mid: [3.0, 5.0, 3.0], high: [5.0, 999, 4.0] },
  walks:        { low: [0, 0.8, 0.5], mid: [0.8, 1.5, 1.0], high: [1.5, 999, 1.5] },
};

const PITCHER_POSITIONS = new Set(['SP', 'RP', 'P', 'LHP', 'RHP']);
const STARTER_POSITIONS = new Set(['SP', 'LHP', 'RHP', 'P']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, ms = 6000) {
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

function avg(vals) {
  const v = vals.filter(x => x != null && !isNaN(x));
  if (!v.length) return null;
  return Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100;
}

function stdDev(vals) {
  const v = vals.filter(x => x != null && !isNaN(x));
  if (v.length < 2) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.round(Math.sqrt(v.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / v.length) * 100) / 100;
}

function parseInnings(ip) {
  if (ip == null) return null;
  const n = parseFloat(ip);
  if (isNaN(n)) return null;
  const full = Math.floor(n);
  const partial = Math.round((n - full) * 10);
  return full + (partial / 3);
}

// ─── Roster ───────────────────────────────────────────────────────────────────

async function findTeamId(league, abbreviation) {
  if (!abbreviation) return null;
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/${league}/teams?limit=50`;
    const data = await fetchWithTimeout(url, 4000);
    const teamList = data?.sports?.[0]?.leagues?.[0]?.teams || data?.teams || [];
    const match = teamList.find(t => {
      const team = t.team || t;
      return team.abbreviation?.toUpperCase() === abbreviation?.toUpperCase();
    });
    return match?.team?.id || match?.id || null;
  } catch {
    return null;
  }
}

async function getTeamRoster(league, teamId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/${league}/teams/${teamId}/roster`;
  const data = await fetchWithTimeout(url, 5000);
  if (!data) return []; // always return array, never null

  const players = [];
  const athletes = data.athletes || [];
  const isFlat = athletes.length > 0 && (athletes[0].id || athletes[0].fullName);

  const pushPlayer = (p) => {
    if (!p.id) return;
    const pos = p.position?.abbreviation || p.position?.name || '';
    players.push({
      id: p.id,
      name: p.displayName || p.fullName,
      position: pos,
      isPitcher: PITCHER_POSITIONS.has(pos),
      isStarter: STARTER_POSITIONS.has(pos),
    });
  };

  if (isFlat) {
    athletes.forEach(pushPlayer);
  } else {
    for (const group of athletes) {
      const items = group.items || group.athletes || group.entries || [];
      items.forEach(pushPlayer);
    }
  }

  return players;
}

// ─── Gamelog fetching ─────────────────────────────────────────────────────────

async function getPlayerGamelog(league, athleteId, isPitcher) {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/baseball/${league}/athletes/${athleteId}/gamelog`;
  const data = await fetchWithTimeout(url, 5000);
  if (!data) return null;

  // DEBUG — log raw ESPN response shape so we can verify the structure
  console.log(`[analyze-mlb] gamelog ${athleteId} names:`, JSON.stringify(data.names?.slice(0, 5)), 'seasonTypes:', data.seasonTypes?.length, 'events:', data.seasonTypes?.[0]?.categories?.[0]?.events?.length);

  const names = data.names || [];
  if (!names.length) return null;

  const seasonType = data.seasonTypes?.[0];
  const categories = seasonType?.categories || [];

  const colIdx = (...candidates) => {
    for (const c of candidates) {
      const i = names.findIndex(n => n === c || n.toLowerCase() === c.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };

  const parseS = (stats, i) => {
    if (i < 0 || i >= stats.length) return null;
    const s = String(stats[i]);
    if (s === '--' || s === '-' || s === '') return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  const allGames = [];

  if (isPitcher) {
    const IP_I   = colIdx('inningsPitched', 'IP');
    const K_I    = colIdx('strikeouts', 'SO', 'K');
    const BB_I   = colIdx('baseOnBalls', 'BB');
    const ER_I   = colIdx('earnedRuns', 'ER');
    const OUTS_I = colIdx('pitchingOuts', 'outsRecorded');

    for (const cat of categories) {
      for (const event of (cat.events || [])) {
        const stats = event.stats || [];
        const ip = parseInnings(parseS(stats, IP_I));
        if (ip == null || ip < 1) continue;

        const outs = OUTS_I >= 0 ? parseS(stats, OUTS_I) : (ip != null ? Math.round(ip * 3) : null);

        allGames.push({
          eventId: event.eventId,
          stats: {
            inningsPitched: ip,
            strikeouts:     parseS(stats, K_I),
            outsRecorded:   outs ?? (ip != null ? Math.round(ip * 3) : null),
            walks:          parseS(stats, BB_I),
            earnedRuns:     parseS(stats, ER_I),
          },
        });
      }
    }
  } else {
    const H_I   = colIdx('hits', 'H');
    const TB_I  = colIdx('totalBases', 'TB');
    const HR_I  = colIdx('homeRuns', 'HR');
    const RBI_I = colIdx('RBI', 'rbi');
    const R_I   = colIdx('runs', 'R');
    const AB_I  = colIdx('atBats', 'AB');

    for (const cat of categories) {
      for (const event of (cat.events || [])) {
        const stats = event.stats || [];
        const ab = parseS(stats, AB_I);
        if (ab === 0 && parseS(stats, H_I) === 0) continue;

        const h   = parseS(stats, H_I)   ?? 0;
        const r   = parseS(stats, R_I)   ?? 0;
        const rbi = parseS(stats, RBI_I) ?? 0;

        allGames.push({
          eventId: event.eventId,
          stats: {
            hits:       h,
            totalBases: parseS(stats, TB_I) ?? h,
            homeRuns:   parseS(stats, HR_I) ?? 0,
            rbi,
            runs:       r,
            hra:        h + r + rbi,
          },
        });
      }
    }
  }

  console.log(`[analyze-mlb] gamelog ${athleteId} allGames parsed: ${allGames.length}`);

  if (!allGames.length) return null;
  allGames.reverse();

  return { allGames, gamesPlayed: allGames.length };
}

// ─── Projection engine ────────────────────────────────────────────────────────

function buildBatterProjection(gamelog) {
  if (!gamelog || gamelog.allGames.length < 1) return null;
  console.log(`[analyze-mlb] buildBatter allGames: ${gamelog.allGames.length}`);

  const games  = gamelog.allGames;
  const last5  = games.slice(0, 5);
  const season = games;
  const projections = {};

  for (const stat of BATTER_STATS) {
    if (stat === 'hra') continue;

    const seasonVals = season.map(g => g.stats[stat]).filter(v => v != null);
    const last5Vals  = last5.map(g => g.stats[stat]).filter(v => v != null);
    if (!seasonVals.length) continue;

    const seasonAvg = avg(seasonVals);
    const last5Avg  = avg(last5Vals);
    const sd        = stdDev(seasonVals);
    const floor     = Math.min(...seasonVals);
    const ceiling   = Math.max(...seasonVals);

    const blended = last5Avg != null
      ? Math.round((last5Avg * 0.6 + seasonAvg * 0.4) * 100) / 100
      : seasonAvg;

    const trend = last5Avg != null && seasonAvg > 0
      ? last5Avg > seasonAvg * 1.2 ? 'up' : last5Avg < seasonAvg * 0.8 ? 'down' : 'neutral'
      : 'neutral';

    const cushionConfig = VARIANCE_CUSHION[stat];
    let cushion = 0.5;
    if (cushionConfig && sd != null) {
      if      (sd < cushionConfig.low[1])  cushion = cushionConfig.low[2];
      else if (sd < cushionConfig.mid[1])  cushion = cushionConfig.mid[2];
      else                                  cushion = cushionConfig.high[2];
    }
    if (trend === 'up')   cushion -= 0.25;
    if (trend === 'down') cushion += 0.25;

    const rawThreshold = blended - cushion;
    const rounded      = Math.round(rawThreshold * 2) / 2;
    const threshold    = Math.max(rounded, SPORTSBOOK_MINIMUMS[stat] || 0.5);
    const edge         = Math.round((blended - threshold) * 100) / 100;

    projections[stat] = {
      seasonAvg, last5Avg, blended, threshold,
      cushion: Math.round(cushion * 100) / 100,
      edge, stdDev: sd, floor, ceiling, trend,
      sampleSize: seasonVals.length,
    };
  }

  // HRA composite
  if (projections.hits && projections.runs && projections.rbi) {
    const hraBlended   = Math.round((projections.hits.blended + projections.runs.blended + projections.rbi.blended) * 100) / 100;
    const hraSeasonAvg = Math.round((projections.hits.seasonAvg + projections.runs.seasonAvg + projections.rbi.seasonAvg) * 100) / 100;
    const hraLast5     = projections.hits.last5Avg != null && projections.runs.last5Avg != null && projections.rbi.last5Avg != null
      ? Math.round((projections.hits.last5Avg + projections.runs.last5Avg + projections.rbi.last5Avg) * 100) / 100
      : null;

    const hraCushionConfig = VARIANCE_CUSHION.hra;
    const hraSd = gamelog.allGames.length >= 2
      ? stdDev(gamelog.allGames.map(g => (g.stats.hits ?? 0) + (g.stats.runs ?? 0) + (g.stats.rbi ?? 0)))
      : null;

    let hraCushion = 1.0;
    if (hraCushionConfig && hraSd != null) {
      if      (hraSd < hraCushionConfig.low[1])  hraCushion = hraCushionConfig.low[2];
      else if (hraSd < hraCushionConfig.mid[1])  hraCushion = hraCushionConfig.mid[2];
      else                                        hraCushion = hraCushionConfig.high[2];
    }

    const hraRaw       = hraBlended - hraCushion;
    const hraThreshold = Math.max(Math.round(hraRaw * 2) / 2, SPORTSBOOK_MINIMUMS.hra);
    const hraEdge      = Math.round((hraBlended - hraThreshold) * 100) / 100;
    const hraTrend     = projections.hits.trend === projections.runs.trend && projections.runs.trend === projections.rbi.trend
      ? projections.hits.trend : 'neutral';

    projections.hra = {
      seasonAvg: hraSeasonAvg, last5Avg: hraLast5, blended: hraBlended,
      threshold: hraThreshold, cushion: hraCushion, edge: hraEdge,
      stdDev: hraSd, trend: hraTrend, sampleSize: gamelog.allGames.length,
      isComposite: true,
    };
  }

  return projections;
}

function buildPitcherProjection(gamelog) {
  if (!gamelog || gamelog.allGames.length < 1) return null;

  const games  = gamelog.allGames;
  const last5  = games.slice(0, 5);
  const season = games;
  const projections = {};

  for (const stat of PITCHER_STATS) {
    const seasonVals = season.map(g => g.stats[stat]).filter(v => v != null);
    const last5Vals  = last5.map(g => g.stats[stat]).filter(v => v != null);
    if (!seasonVals.length) continue;

    const seasonAvg = avg(seasonVals);
    const last5Avg  = avg(last5Vals);
    const sd        = stdDev(seasonVals);
    const floor     = Math.min(...seasonVals);
    const ceiling   = Math.max(...seasonVals);

    const blended = last5Avg != null
      ? Math.round((last5Avg * 0.55 + seasonAvg * 0.45) * 100) / 100
      : seasonAvg;

    const trend = last5Avg != null && seasonAvg > 0
      ? last5Avg > seasonAvg * 1.15 ? 'up' : last5Avg < seasonAvg * 0.85 ? 'down' : 'neutral'
      : 'neutral';

    const cushionConfig = VARIANCE_CUSHION[stat];
    let cushion = 1.0;
    if (cushionConfig && sd != null) {
      if      (sd < cushionConfig.low[1])  cushion = cushionConfig.low[2];
      else if (sd < cushionConfig.mid[1])  cushion = cushionConfig.mid[2];
      else                                  cushion = cushionConfig.high[2];
    }
    if (trend === 'up')   cushion -= 0.5;
    if (trend === 'down') cushion += 0.5;

    const rawThreshold = blended - cushion;
    const rounded      = Math.round(rawThreshold * 2) / 2;
    const threshold    = Math.max(rounded, SPORTSBOOK_MINIMUMS[stat] || 0.5);
    const edge         = Math.round((blended - threshold) * 100) / 100;

    projections[stat] = {
      seasonAvg, last5Avg, blended, threshold,
      cushion: Math.round(cushion * 100) / 100,
      edge, stdDev: sd, floor, ceiling, trend,
      sampleSize: seasonVals.length,
    };
  }

  const ipVals = season.map(g => g.stats.inningsPitched).filter(v => v != null);
  if (ipVals.length) {
    projections._avgInnings   = Math.round(avg(ipVals) * 10) / 10;
    projections._last5Innings = Math.round(avg(last5.map(g => g.stats.inningsPitched).filter(v => v != null)) * 10) / 10;
  }

  return projections;
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

function formatPlayerForPrompt(player, projections) {
  const isPitcher = player.isPitcher;
  const stats = isPitcher ? PITCHER_STATS : BATTER_STATS;
  const lines = [`${player.teamAbbrev} | ${player.name} (${player.position}) ${isPitcher ? '[PITCHER]' : '[BATTER]'}`];

  if (isPitcher && projections._avgInnings) {
    lines.push(`  Avg innings per start: ${projections._avgInnings} | Last 5 starts avg: ${projections._last5Innings ?? '?'}`);
  }

  for (const stat of stats) {
    const p = projections[stat];
    if (!p || p.blended == null) continue;

    const label = stat === 'hra' ? 'H+R+RBI' : stat === 'outsRecorded' ? 'Outs Recorded' : stat === 'rbi' ? 'RBI' : stat.charAt(0).toUpperCase() + stat.slice(1);
    const trendIcon = p.trend === 'up' ? 'TRENDING UP' : p.trend === 'down' ? 'TRENDING DOWN' : 'NEUTRAL';
    const compositeNote = p.isComposite ? ' [COMPOSITE: H+R+RBI]' : '';

    lines.push(
      `  ${label.toUpperCase()}:${compositeNote}
    Projection: ${p.blended} (L5=${p.last5Avg ?? '?'} Season=${p.seasonAvg ?? '?'})
    Suggested threshold: Over ${p.threshold} | Cushion: ${p.cushion} | Edge: ${p.edge}
    Variance (std dev): ${p.stdDev ?? '?'} | Floor: ${p.floor ?? '?'} | Ceiling: ${p.ceiling ?? '?'}
    Trend: ${trendIcon} | Sample: ${p.sampleSize} games`
    );
  }

  return lines.join('\n');
}

async function generateMLBPicks(game, playerData, existingLegs, legCount) {
  const pitchers = playerData.filter(p => p.isPitcher);
  const batters  = playerData.filter(p => !p.isPitcher);

  const pitcherLines = pitchers.map(p => formatPlayerForPrompt(p, p.projections)).join('\n\n');
  const batterLines  = batters.map(p => formatPlayerForPrompt(p, p.projections)).join('\n\n');

  const existingLegsText = existingLegs.length > 0
    ? `\nEXISTING LEGS (exclude these players):\n${existingLegs.map((l, i) => `${i + 1}. ${l.player} - ${l.stat}`).join('\n')}\n`
    : '';

  const prompt = `You are an expert sports bettor generating MLB pre-game prop pick recommendations. You have historical projections for batters and pitchers based on season averages and recent form.

GAME: ${game.awayTeam?.name ?? 'Away'} @ ${game.homeTeam?.name ?? 'Home'}
DATE: ${game.gameDate}
${existingLegsText}

STARTING PITCHERS:
${pitcherLines || 'No pitcher data available'}

BATTERS:
${batterLines || 'No batter data available'}

HOW TO USE THESE PROJECTIONS:

THRESHOLD LOGIC:
- Suggested threshold = blended projection minus variance cushion
- Blended = 60% last 5 games + 40% season average (55/45 for pitchers)
- Edge = cushion between projection and threshold
- Always use the suggested threshold since no sportsbook lines are available

MINIMUM THRESHOLDS (never recommend below these):
- Hits: 0.5 | Total Bases: 1.5 | Home Runs: 0.5 | RBI: 0.5 | Runs: 0.5 | H+R+RBI: 2.5
- Strikeouts: 3.5 | Outs Recorded: 10.5 | Walks: 0.5

RATING FRAMEWORK (1-5 stars):
5 stars: projection well above threshold + trending up + consistent recent form + low variance
4 stars: projection above threshold + at least 2 positive factors
3 stars: projection above threshold + mixed signals
2 stars: marginal edge or high variance or trending down
1 star: only weak edge or major risk flags
DEDUCT 1 star for: high std dev relative to projection, small sample size (<10 games), or extreme outlier in recent form

BASEBALL-SPECIFIC FACTORS:
- For pitchers: innings projection matters -- a pitcher averaging 5 innings has more outs/K ceiling than a 4-inning pitcher
- For batters: home runs have very high variance -- be conservative with HR props unless clear trend
- H+R+RBI composite: strong pick when all three components trend the same direction
- Total bases: driven by extra-base hits -- check if player has power in recent games (high TB relative to hits)
- Trending up in last 5 is a strong signal in baseball -- hot streaks are real

STAT LABELS FOR OUTPUT:
- Use exactly: "Hits", "Total Bases", "Home Runs", "RBI", "Runs", "H+R+RBI", "Strikeouts", "Outs Recorded", "Walks"

For each pick provide:
- player: exact full name
- team: team abbreviation
- stat: one of the stat labels above
- direction: always "Over"
- threshold: the exact number to bet Over on
- projection: the blended projection number
- edge: cushion between projection and threshold
- rationale: 2-3 sentences citing SPECIFIC numbers from the projections
- rating: 1-5 stars
- rating_reason: one sentence explaining the rating
- risk_flags: array of concern strings (empty if clean)

Return ONLY valid JSON, no markdown:
{
  "game_summary": "2-3 sentences on the matchup",
  "picks": [
    {
      "player": "Full Name",
      "team": "ABV",
      "stat": "Hits",
      "direction": "Over",
      "threshold": 0.5,
      "projection": 1.2,
      "edge": 0.7,
      "rationale": "...",
      "rating": 4,
      "rating_reason": "...",
      "risk_flags": []
    }
  ]
}

Recommend exactly ${legCount} picks if ${legCount} strong options exist. Never pad with weak picks. Consider both pitcher and batter props equally. Prioritize picks where projection clearly exceeds threshold with low variance.`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const jsonStart = raw.indexOf('{');
  const jsonEnd   = raw.lastIndexOf('}');
  const cleaned   = jsonStart !== -1 && jsonEnd !== -1 ? raw.substring(jsonStart, jsonEnd + 1) : raw;

  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    console.error('[analyze-mlb] JSON parse error:', parseErr.message);
    try {
      const sanitized = cleaned
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/([^\\])\\([^"\\/bfnrtu])/g, '$1 $2');
      return JSON.parse(sanitized);
    } catch {
      throw new Error(`Claude response JSON parse failed: ${parseErr.message}`);
    }
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameId, league = 'mlb', homeTeam, awayTeam, gameDate, existingLegs, legCount = 4, mode = 'picks' } = req.body;

  if (!gameId) {
    return res.status(400).json({ error: 'Missing required field: gameId' });
  }

  try {
    console.log(`[analyze-mlb] Analyzing ${gameId} (MLB) mode=${mode}`);

    const resolvedHomeId = homeTeam?.id || await findTeamId(league, homeTeam?.abbreviation);
    const resolvedAwayId = awayTeam?.id || await findTeamId(league, awayTeam?.abbreviation);

    console.log(`[analyze-mlb] homeId: ${resolvedHomeId}, awayId: ${resolvedAwayId}`);

    const [homeRoster, awayRoster] = await Promise.all([
      resolvedHomeId ? getTeamRoster(league, resolvedHomeId) : [],
      resolvedAwayId ? getTeamRoster(league, resolvedAwayId) : [],
    ]);

    console.log(`[analyze-mlb] homeRoster: ${homeRoster.length}, awayRoster: ${awayRoster.length}`);

    const homeBatters  = homeRoster.filter(p => !p.isPitcher).slice(0, 9).map(p => ({ ...p, isHome: true,  teamAbbrev: homeTeam?.abbreviation || 'HME' }));
    const awayBatters  = awayRoster.filter(p => !p.isPitcher).slice(0, 9).map(p => ({ ...p, isHome: false, teamAbbrev: awayTeam?.abbreviation || 'AWY' }));
    const homePitchers = homeRoster.filter(p => p.isStarter).slice(0, 1).map(p => ({ ...p, isHome: true,  teamAbbrev: homeTeam?.abbreviation || 'HME' }));
    const awayPitchers = awayRoster.filter(p => p.isStarter).slice(0, 1).map(p => ({ ...p, isHome: false, teamAbbrev: awayTeam?.abbreviation || 'AWY' }));
    const allPlayers   = [...homePitchers, ...awayPitchers, ...homeBatters, ...awayBatters];

    console.log(`[analyze-mlb] Analyzing ${allPlayers.length} players (${homePitchers.length + awayPitchers.length} pitchers, ${homeBatters.length + awayBatters.length} batters)`);

    const gamelogResults = await Promise.all(
      allPlayers.map(p =>
        getPlayerGamelog(league, p.id, p.isPitcher).catch(() => null)
      )
    );

    console.log(`[analyze-mlb] Gamelogs: ${gamelogResults.filter(Boolean).length}/${allPlayers.length} fetched`);

    const playerData = allPlayers.map((p, i) => {
      const gamelog = gamelogResults[i];
      if (!gamelog || gamelog.gamesPlayed < 1) return null;

      const projections = p.isPitcher
        ? buildPitcherProjection(gamelog)
        : buildBatterProjection(gamelog);

      if (!projections || Object.keys(projections).length === 0) return null;

      return { ...p, projections, gamesPlayed: gamelog.gamesPlayed };
    }).filter(Boolean);

    console.log(`[analyze-mlb] Built projections for ${playerData.length} players`);

    if (playerData.length === 0) {
      return res.status(404).json({ error: 'Could not build projections for any players in this game' });
    }

    const targetLegCount = mode === 'daily' ? 2 : legCount;
    const picks = await generateMLBPicks(
      { homeTeam, awayTeam, gameDate },
      playerData,
      existingLegs || [],
      targetLegCount
    );

    const picksWithMeta = (picks.picks || []).map(pick => ({
      ...pick,
      hasRealLine: false,
      model: 'claude-haiku-4-5-20251001',
      sport: 'mlb',
    }));

    return res.status(200).json({
      success: true,
      gameId,
      game: { homeTeam, awayTeam, league, gameDate },
      mode,
      ...picks,
      picks: picksWithMeta,
      player_count: playerData.length,
      analyzed_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[analyze-mlb] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
