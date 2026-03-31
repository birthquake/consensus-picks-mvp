// FILE LOCATION: api/pregame/analyze-mlb.js
// MLB pre-game prop pick generator — robust model (NHL-parity update)
//
// Factors added in this revision:
//   - Opponent pitcher ERA / team ERA → multiplier on batter projections
//   - Pitcher rest detection → short-rest penalty (< 4 days), bonus for extra rest
//   - Data-driven star rating (computeRating) — replaces Claude's subjective confidence
//   - Hard projection filter — picks where projection doesn't clear line dropped in code
//   - Floor detection extended to last 10 games (was season-wide min)
//
// BATTERS:
//   - Season avg hits, total bases, home runs, RBI, runs, HRA (hits+runs+RBI)
//   - Last 5 game rolling averages for trend detection
//   - Variance (std dev) over season → determines cushion on threshold
//   - Floor detection — worst game in last 10 (near-free if floor >= line)
//   - Opponent ERA multiplier — boosts/reduces projection vs league avg ERA
//
// PITCHERS (SP only):
//   - Season avg strikeouts, outs recorded, walks per start
//   - Last 5 starts rolling averages
//   - Projected innings based on season avg
//   - Rest-day adjustment — short rest penalty, extra rest bonus
//
// Usage: POST /api/pregame/analyze-mlb
// Body: { gameId, sport, league, homeTeam, awayTeam, gameDate, existingLegs?, legCount? }

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── MLB league averages (2024-25 season approximations) ─────────────────────
const MLB_AVG = {
  teamERA:    4.30,
  starterERA: 4.50,
};

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
  if (!data) return [];

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

// ─── Opponent ERA / team pitching stats ───────────────────────────────────────
// Fetches the opposing team's ERA from ESPN team statistics.
// Multiplier capped at +/-20% (same cap as NHL opponent adjustment).
// Higher ERA = weaker pitching = more batter upside.

async function getTeamPitchingStats(league, teamId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/${league}/teams/${teamId}/statistics`;
  const data = await fetchWithTimeout(url, 3000);
  if (!data) return null;

  const categories = data?.results?.stats?.categories ?? data?.stats?.categories ?? [];

  let teamERA     = null;
  let starterERA  = null;
  let gamesPlayed = null;
  let whip        = null;

  for (const cat of categories) {
    for (const stat of cat?.stats ?? []) {
      const name = stat.name?.toLowerCase();
      const val  = parseFloat(stat.value);
      if (isNaN(val)) continue;
      if (name === 'era' || name === 'earnedrunavg')        teamERA     = val;
      if (name === 'spera' || name === 'startingera')       starterERA  = val;
      if (name === 'gamesplayed' || name === 'games')       gamesPlayed = val;
      if (name === 'whip')                                  whip        = val;
    }
  }

  const era = starterERA ?? teamERA;
  if (era == null) return null;

  const rawMultiplier = era / MLB_AVG.starterERA;
  const batterMultiplier = Math.max(0.80, Math.min(1.20, rawMultiplier));

  return {
    era:              Math.round(era * 100) / 100,
    whip,
    gamesPlayed,
    batterMultiplier: Math.round(batterMultiplier * 100) / 100,
  };
}

// ─── Pitcher rest detection ───────────────────────────────────────────────────
// MLB standard rotation: ~5 days rest.
// Short rest (< 4 days) → 8% penalty on K and outs projections.
// Extra rest (> 6 days) → 4% bonus.

async function getPitcherRestDays(league, teamId, gameDate) {
  const today = gameDate ? new Date(gameDate) : new Date();
  const yyyy  = today.getFullYear();

  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/${league}/teams/${teamId}/schedule?season=${yyyy}`;
  const data = await fetchWithTimeout(url, 3000);
  if (!data) return null;

  const todayStr = today.toISOString().substring(0, 10).replace(/-/g, '');
  const events   = data?.events ?? [];

  const completed = events.filter(e => {
    const eDate = (e.date ?? '').substring(0, 10).replace(/-/g, '');
    return eDate < todayStr && e.competitions?.[0]?.status?.type?.completed;
  });

  if (!completed.length) return null;

  const lastGame     = completed[completed.length - 1];
  const lastGameDate = new Date(lastGame.date);
  const diffMs       = today - lastGameDate;
  const daysSince    = diffMs / (1000 * 60 * 60 * 24);

  return {
    lastGameDate:      lastGame.date,
    daysSinceLastGame: Math.round(daysSince * 10) / 10,
    isShortRest:       daysSince < 4,
    isExtraRest:       daysSince > 6,
  };
}

// ─── Gamelog fetching ─────────────────────────────────────────────────────────

async function getPlayerGamelog(league, athleteId, isPitcher) {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/baseball/${league}/athletes/${athleteId}/gamelog`;
  const data = await fetchWithTimeout(url, 5000);
  if (!data) return null;

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

  if (!allGames.length) return null;
  allGames.reverse(); // most recent first

  return { allGames, gamesPlayed: allGames.length };
}

// ─── Projection engine ────────────────────────────────────────────────────────

function buildBatterProjection(gamelog, opponentERA) {
  if (!gamelog || gamelog.allGames.length < 1) return null;

  const games  = gamelog.allGames;
  const last5  = games.slice(0, 5);
  const last10 = games.slice(0, 10);
  const season = games;
  const projections = {};

  // Opponent ERA multiplier: higher ERA = weaker pitching = batter upside
  const oppMult = opponentERA?.batterMultiplier ?? 1.0;
  const oppERA  = opponentERA?.era ?? null;

  for (const stat of BATTER_STATS) {
    if (stat === 'hra') continue;

    const seasonVals = season.map(g => g.stats[stat]).filter(v => v != null);
    const last5Vals  = last5.map(g => g.stats[stat]).filter(v => v != null);
    const last10Vals = last10.map(g => g.stats[stat]).filter(v => v != null);
    if (!seasonVals.length) continue;

    const seasonAvg = avg(seasonVals);
    const last5Avg  = avg(last5Vals);
    const sd        = stdDev(seasonVals);
    const floor     = last10Vals.length ? Math.min(...last10Vals) : Math.min(...seasonVals);
    const ceiling   = Math.max(...seasonVals);

    // 60/40 blend, then apply opponent ERA multiplier
    const rawBlended = last5Avg != null
      ? Math.round((last5Avg * 0.6 + seasonAvg * 0.4) * 100) / 100
      : seasonAvg;
    const blended = Math.round(rawBlended * oppMult * 100) / 100;

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
      oppMult, oppERA,
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
    const hraVals = gamelog.allGames.map(g => (g.stats.hits ?? 0) + (g.stats.runs ?? 0) + (g.stats.rbi ?? 0));
    const hraSd   = gamelog.allGames.length >= 2 ? stdDev(hraVals) : null;
    const hraLast10Vals = hraVals.slice(0, 10);
    const hraFloor      = hraLast10Vals.length ? Math.min(...hraLast10Vals) : null;

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
      stdDev: hraSd, floor: hraFloor, trend: hraTrend, sampleSize: gamelog.allGames.length,
      oppMult, oppERA,
      isComposite: true,
    };
  }

  return projections;
}

function buildPitcherProjection(gamelog, restInfo) {
  if (!gamelog || gamelog.allGames.length < 1) return null;

  const games  = gamelog.allGames;
  const last5  = games.slice(0, 5);
  const last10 = games.slice(0, 10);
  const season = games;
  const projections = {};

  // Rest adjustment: short rest penalty, extra rest bonus
  const restMult = restInfo?.isShortRest ? 0.92
                 : restInfo?.isExtraRest ? 1.04
                 : 1.0;

  for (const stat of PITCHER_STATS) {
    const seasonVals = season.map(g => g.stats[stat]).filter(v => v != null);
    const last5Vals  = last5.map(g => g.stats[stat]).filter(v => v != null);
    const last10Vals = last10.map(g => g.stats[stat]).filter(v => v != null);
    if (!seasonVals.length) continue;

    const seasonAvg = avg(seasonVals);
    const last5Avg  = avg(last5Vals);
    const sd        = stdDev(seasonVals);
    const floor     = last10Vals.length ? Math.min(...last10Vals) : Math.min(...seasonVals);
    const ceiling   = Math.max(...seasonVals);

    const rawBlended = last5Avg != null
      ? Math.round((last5Avg * 0.55 + seasonAvg * 0.45) * 100) / 100
      : seasonAvg;
    const blended = Math.round(rawBlended * restMult * 100) / 100;

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
    if (restInfo?.isShortRest) cushion += 0.5; // widen cushion on short rest

    const rawThreshold = blended - cushion;
    const rounded      = Math.round(rawThreshold * 2) / 2;
    const threshold    = Math.max(rounded, SPORTSBOOK_MINIMUMS[stat] || 0.5);
    const edge         = Math.round((blended - threshold) * 100) / 100;

    projections[stat] = {
      seasonAvg, last5Avg, blended, threshold,
      cushion: Math.round(cushion * 100) / 100,
      edge, stdDev: sd, floor, ceiling, trend,
      sampleSize: seasonVals.length,
      restMult,
      isShortRest:       !!restInfo?.isShortRest,
      isExtraRest:       !!restInfo?.isExtraRest,
      daysSinceLastGame: restInfo?.daysSinceLastGame ?? null,
    };
  }

  const ipVals = season.map(g => g.stats.inningsPitched).filter(v => v != null);
  if (ipVals.length) {
    projections._avgInnings   = Math.round(avg(ipVals) * 10) / 10;
    projections._last5Innings = Math.round(avg(last5.map(g => g.stats.inningsPitched).filter(v => v != null)) * 10) / 10;
  }

  return projections;
}

// ─── Data-driven star rating ──────────────────────────────────────────────────
// Replaces Claude's subjective confidence string.
// Baseline 3 stars, adjust from factors. Same philosophy as NHL computeRating.

function computeRating(proj) {
  if (!proj) return 3;

  let score = 0;

  // 1. Edge relative to threshold
  const edgePct = proj.threshold > 0 ? proj.edge / proj.threshold : 0;
  if (edgePct > 0.30) score += 2;
  else if (edgePct > 0.15) score += 1;

  // 2. Trend aligned with over
  if (proj.trend === 'up')   score += 1;
  if (proj.trend === 'down') score -= 1;

  // 3. Low variance = predictable
  if (proj.stdDev != null && proj.stdDev < proj.edge) score += 1;

  // 4. Floor at/above line = near-free pick
  if (proj.floor != null && proj.floor >= proj.threshold) score += 2;

  // 5. Opponent ERA multiplier direction
  if (proj.oppMult != null) {
    if (proj.oppMult > 1.08) score += 1;
    if (proj.oppMult < 0.92) score -= 1;
  }

  // 6. Pitcher rest flags
  if (proj.isShortRest) score -= 1;
  if (proj.isExtraRest) score += 1;

  // 7. Small sample penalty
  if (proj.sampleSize != null && proj.sampleSize < 10) score -= 1;

  return Math.max(1, Math.min(5, score + 3)); // baseline 3
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

    let contextLine = '';
    if (!isPitcher && p.oppMult != null && p.oppMult !== 1.0) {
      contextLine = `\n    Opp ERA: ${p.oppERA ?? '?'} (mult: ${p.oppMult}x vs league avg ${MLB_AVG.starterERA})`;
    }
    if (isPitcher) {
      const restNote = p.isShortRest ? ' ⚠️SHORT REST' : p.isExtraRest ? ' ✅EXTRA REST' : '';
      contextLine = `\n    Rest: ${p.daysSinceLastGame ?? '?'} days since last game${restNote}`;
    }

    lines.push(
      `  ${label.toUpperCase()}:${compositeNote}
    Projection: ${p.blended} (L5=${p.last5Avg ?? '?'} Season=${p.seasonAvg ?? '?'})
    Suggested threshold: Over ${p.threshold} | Cushion: ${p.cushion} | Edge: ${p.edge}
    Variance (std dev): ${p.stdDev ?? '?'} | Floor: ${p.floor ?? '?'} | Ceiling: ${p.ceiling ?? '?'}
    Trend: ${trendIcon} | Sample: ${p.sampleSize} games | Star rating: ${p._computedRating ?? '?'}${contextLine}`
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

  const prompt = `You are an expert sports bettor generating MLB pre-game prop pick recommendations. You have historical projections for batters and pitchers based on season averages and recent form. Each stat already has a pre-computed star rating — use that rating exactly, do not override it.

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
- Blended = 60% last 5 games + 40% season average (55/45 for pitchers), adjusted by opponent ERA multiplier (batters) or rest multiplier (pitchers)
- Edge = cushion between projection and threshold
- Always use the suggested threshold since no sportsbook lines are available
- HARD RULE: Only recommend picks where projection > threshold. Never recommend a pick where projection <= threshold.

MINIMUM THRESHOLDS (never recommend below these):
- Hits: 0.5 | Total Bases: 1.5 | Home Runs: 0.5 | RBI: 0.5 | Runs: 0.5 | H+R+RBI: 2.5
- Strikeouts: 3.5 | Outs Recorded: 10.5 | Walks: 0.5

RATING RULE: Use the "Star rating" shown in each stat block exactly as given (integer 1-5). Do not assign your own rating.

BASEBALL-SPECIFIC FACTORS:
- For pitchers: innings projection matters — a pitcher averaging 5 innings has more outs/K ceiling than a 4-inning pitcher
- Short rest pitchers are risky for K/outs props even with a good trend
- High opponent ERA multiplier (> 1.08x) is a meaningful batter boost
- For batters: home runs have very high variance — be conservative with HR props unless clear trend
- H+R+RBI composite: strong pick when all three components trend the same direction
- Total bases: driven by extra-base hits — check if player has power in recent games (high TB relative to hits)
- Trending up in last 5 is a strong signal in baseball — hot streaks are real

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
- rating: the pre-computed star rating from the stat block (integer 1-5)
- rating_reason: one sentence explaining the key factors behind the rating
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

    // Fetch rosters + opponent pitching stats + rest info in parallel
    // ERA and rest fetches are best-effort — failures return null gracefully
    // Note: away pitcher faces home batters → homeERA slot = resolvedAwayId's stats, and vice versa
    const [homeRoster, awayRoster, homeERA, awayERA, homeRest, awayRest] = await Promise.all([
      resolvedHomeId ? getTeamRoster(league, resolvedHomeId)                                            : [],
      resolvedAwayId ? getTeamRoster(league, resolvedAwayId)                                            : [],
      resolvedAwayId ? getTeamPitchingStats(league, resolvedAwayId).catch(() => null)                   : null,
      resolvedHomeId ? getTeamPitchingStats(league, resolvedHomeId).catch(() => null)                   : null,
      resolvedHomeId ? getPitcherRestDays(league, resolvedHomeId, gameDate).catch(() => null)           : null,
      resolvedAwayId ? getPitcherRestDays(league, resolvedAwayId, gameDate).catch(() => null)           : null,
    ]);

    console.log(`[analyze-mlb] homeRoster: ${homeRoster.length}, awayRoster: ${awayRoster.length}`);
    console.log(`[analyze-mlb] awayERA (faces home batters): ${homeERA?.era ?? 'n/a'}, homeERA (faces away batters): ${awayERA?.era ?? 'n/a'}`);
    console.log(`[analyze-mlb] homeRest: ${homeRest?.daysSinceLastGame ?? 'n/a'}d, awayRest: ${awayRest?.daysSinceLastGame ?? 'n/a'}d`);

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

      // Batters face the OPPOSING team's pitcher:
      //   home batters face away pitcher → homeERA (which was fetched as resolvedAwayId's stats)
      //   away batters face home pitcher → awayERA (which was fetched as resolvedHomeId's stats)
      const opponentERA = p.isPitcher ? null
                        : p.isHome   ? homeERA   // home batters face away pitcher
                        :              awayERA;  // away batters face home pitcher

      const restInfo = p.isPitcher
        ? (p.isHome ? homeRest : awayRest)
        : null;

      const projections = p.isPitcher
        ? buildPitcherProjection(gamelog, restInfo)
        : buildBatterProjection(gamelog, opponentERA);

      if (!projections || Object.keys(projections).length === 0) return null;

      // Inject computed star ratings before hard filter and prompt formatting
      const statsToRate = p.isPitcher ? PITCHER_STATS : BATTER_STATS;
      for (const stat of statsToRate) {
        if (projections[stat]) {
          projections[stat]._computedRating = computeRating(projections[stat]);
        }
      }
      // Also rate hra composite
      if (projections.hra) {
        projections.hra._computedRating = computeRating(projections.hra);
      }

      return { ...p, projections, gamesPlayed: gamelog.gamesPlayed };
    }).filter(Boolean);

    console.log(`[analyze-mlb] Built projections for ${playerData.length} players`);

    // Hard filter: drop stat projections that don't clear their threshold
    // Same pattern as NHL hard filter — prevents model recommending bad lines
    for (const p of playerData) {
      const statsToCheck = p.isPitcher ? PITCHER_STATS : [...BATTER_STATS];
      for (const stat of statsToCheck) {
        const proj = p.projections[stat];
        if (proj && proj.blended != null && proj.threshold != null) {
          if (proj.blended <= proj.threshold) {
            delete p.projections[stat];
          }
        }
      }
    }

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
