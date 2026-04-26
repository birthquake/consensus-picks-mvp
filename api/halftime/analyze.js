// FILE LOCATION: api/halftime/analyze.js
// Given a live in-game ID, pulls:
//   - Full box score so far (points, minutes, FG, rebounds, assists, fouls, +/-)
//   - Season averages for key stats + minutes (for projection math)
//   - Last 5 + last 10 game averages (trend windows)
//   - Per-player projections: rate-based remaining output with regression adjustment
// Then runs Claude to generate rated pick recommendations.
// Works for any quarter/period, not just halftime.

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STAT_KEYS = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers'];

const BOX_KEY_MAP = {
  minutes:       'minutes',
  points:        'points',
  rebounds:      'rebounds',
  assists:       'assists',
  steals:        'steals',
  blocks:        'blocks',
  turnovers:     'turnovers',
  fouls:         'fouls',
  plusMinus:     'plusMinus',
  fieldGoalsMade:'fieldGoalsMade-fieldGoalsAttempted',
};

const REGRESSION_STATS = ['points', 'rebounds', 'assists'];

const REGRESSION_WEIGHT = {
  points:   0.45,
  rebounds: 0.30,
  assists:  0.30,
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
    const statsArr = cat.stats || cat.values || [];
    for (const s of statsArr) {
      const name = s.name?.toLowerCase();
      const abbr = s.abbreviation?.toLowerCase();
      const val  = parseFloat(s.displayValue ?? s.value);
      if (isNaN(val)) continue;

      if (name === 'avgpoints'     || abbr === 'ppg' || name === 'points')   result.points   = val;
      if (name === 'avgrebounds'   || abbr === 'rpg' || name === 'rebounds') result.rebounds = val;
      if (name === 'avgassists'    || abbr === 'apg' || name === 'assists')  result.assists  = val;
      if (name === 'avgminutes'    || abbr === 'mpg' || name === 'minutes')  result.minutes  = val;
      if (name === 'fieldgoalspct' || abbr === 'fg%' || name === 'fgpct')   result.fgPct    = val;
      if (name === 'avgsteals'     || abbr === 'spg' || name === 'steals')  result.steals   = val;
      if (name === 'avgblocks'     || abbr === 'bpg' || name === 'blocks')  result.blocks   = val;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ─── Projection engine ────────────────────────────────────────────────────────

function buildProjection(player, seasonAvg, historicalForm, gameContext) {
  const s = player.stats;
  const firstHalfMinutes = s.minutes || 0;

  if (firstHalfMinutes < 5) return null;

  const seasonMinutes = seasonAvg?.minutes || 28;
  let projectedRemainingMinutes = Math.max(0, seasonMinutes - firstHalfMinutes);

  const fouls = s.fouls || 0;
  if (fouls >= 3)      projectedRemainingMinutes *= 0.55;
  else if (fouls === 2) projectedRemainingMinutes *= 0.80;

  const scoreDiff = gameContext.scoreDiff || 0;
  if (scoreDiff >= 25)      projectedRemainingMinutes *= 0.65;
  else if (scoreDiff >= 15) projectedRemainingMinutes *= 0.85;

  projectedRemainingMinutes = Math.round(projectedRemainingMinutes * 10) / 10;

  const projections = {};

  for (const stat of REGRESSION_STATS) {
    const firstHalfValue = s[stat] ?? 0;
    if (firstHalfMinutes === 0) continue;

    const currentRate = firstHalfValue / firstHalfMinutes;
    const seasonTotal = seasonAvg?.[stat]
      || historicalForm?.averages?.last10?.[stat]
      || historicalForm?.averages?.last5?.[stat];

    const seasonRate = seasonTotal && seasonMinutes > 0
      ? seasonTotal / seasonMinutes
      : currentRate;

    const regWeight = REGRESSION_WEIGHT[stat] || 0.35;
    const adjustedRate = (currentRate * (1 - regWeight)) + (seasonRate * regWeight);

    const conservative = Math.round((firstHalfValue + (seasonRate * projectedRemainingMinutes)) * 10) / 10;
    const aggressive   = Math.round((firstHalfValue + (currentRate * projectedRemainingMinutes)) * 10) / 10;
    const blended      = Math.round((firstHalfValue + (adjustedRate * projectedRemainingMinutes)) * 10) / 10;

    let efficiencyNote = null;
    if (stat === 'points' && seasonAvg?.fgPct) {
      const fgMade = s.fieldGoalsMade || 0;
      const totalFGAttempts = fgMade + (s.fieldGoalsAttempted || fgMade);
      const currentFgPct = totalFGAttempts > 0 ? (fgMade / totalFGAttempts) * 100 : null;
      if (currentFgPct !== null) {
        const pctDiff = currentFgPct - seasonAvg.fgPct;
        if (pctDiff > 10)       efficiencyNote = `shooting ${pctDiff.toFixed(0)}% above season FG% -- regression likely`;
        else if (pctDiff < -10) efficiencyNote = `shooting ${Math.abs(pctDiff).toFixed(0)}% below season FG% -- positive regression possible`;
      }
    }

    projections[stat] = {
      firstHalfValue,
      firstHalfMinutes,
      projectedRemainingMinutes,
      seasonAvg: seasonTotal ? Math.round(seasonTotal * 10) / 10 : null,
      conservative,
      blended,
      aggressive,
      efficiencyNote,
      vsExpected: seasonRate > 0
        ? Math.round((currentRate / seasonRate) * 100)
        : null,
    };
  }

  return {
    projectedRemainingMinutes,
    seasonMinutes,
    foulReduction: fouls >= 2,
    blowoutReduction: scoreDiff >= 15,
    projections,
  };
}

function formatProjectionForPrompt(player, proj, seasonAvg) {
  if (!proj) return '';

  const lines = [];
  lines.push(`    Projected remaining minutes: ~${proj.projectedRemainingMinutes} (season avg ${proj.seasonMinutes}min${proj.foulReduction ? ', reduced for fouls' : ''}${proj.blowoutReduction ? ', reduced for score diff' : ''})`);

  for (const stat of REGRESSION_STATS) {
    const p = proj.projections[stat];
    if (!p) continue;

    const label = stat.charAt(0).toUpperCase() + stat.slice(1);
    const onPace = p.vsExpected != null ? ` [${p.vsExpected}% of expected pace]` : '';
    const efficiency = p.efficiencyNote ? ` ${p.efficiencyNote}` : '';

    lines.push(
      `    ${label} projection: conservative=${p.conservative} | blended=${p.blended} | aggressive=${p.aggressive}${onPace}${efficiency}`
    );
    if (p.seasonAvg != null) {
      lines.push(`      (season avg ${p.seasonAvg} | first half: ${p.firstHalfValue})`);
    }
  }

  return lines.join('\n');
}

// ─── Live box score ───────────────────────────────────────────────────────────

async function getLiveBoxScore(sport, league, gameId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${gameId}`;
  const data = await fetchWithTimeout(url, 6000);
  if (!data?.boxscore?.players) return null;

  const players = [];

  for (const group of data.boxscore.players) {
    const statsBlock = group.statistics?.[0];
    if (!statsBlock) continue;

    const keys = statsBlock.keys || [];
    const teamId     = group.team?.id;
    const teamAbbrev = group.team?.abbreviation;

    for (const athlete of (statsBlock.athletes || [])) {
      if (athlete.didNotPlay || !athlete.stats?.length) continue;

      const minutesIdx = keys.indexOf('minutes');
      const minutes = minutesIdx >= 0 ? parseFloat(athlete.stats[minutesIdx]) || 0 : 0;
      if (minutes < 3) continue;

      const playerStats = { minutes };

      for (const [statName, espnKey] of Object.entries(BOX_KEY_MAP)) {
        if (statName === 'fieldGoalsMade') {
          // ESPN returns FG as "made-attempted" string e.g. "5-9"
          // Split into both fields so FG% calculation is accurate
          const idx = keys.findIndex(k => k === 'fieldGoalsMade-fieldGoalsAttempted' || k === 'fieldGoalsMade');
          if (idx >= 0) {
            const raw = String(athlete.stats[idx] ?? '');
            if (raw.includes('-') && !raw.startsWith('-')) {
              const parts = raw.split('-');
              playerStats.fieldGoalsMade      = parseInt(parts[0], 10) || 0;
              playerStats.fieldGoalsAttempted = parseInt(parts[1], 10) || 0;
            } else {
              playerStats.fieldGoalsMade      = parseFloat(raw) || 0;
              playerStats.fieldGoalsAttempted = playerStats.fieldGoalsMade;
            }
          }
          continue;
        }

        const idx = keys.findIndex(k => k === espnKey || k.startsWith(espnKey.split('-')[0]));
        if (idx >= 0) {
          const raw = athlete.stats[idx];
          if (raw != null && raw !== '') {
            playerStats[statName] = parseStatValue(String(raw));
          }
        }
      }

      players.push({
        id: athlete.athlete?.id,
        name: athlete.athlete?.displayName,
        shortName: athlete.athlete?.shortName,
        position: athlete.athlete?.position?.abbreviation,
        jersey: athlete.athlete?.jersey,
        teamId,
        teamAbbrev,
        starter: athlete.starter,
        stats: playerStats,
      });
    }
  }

  const competition = data.header?.competitions?.[0];
  const gameContext = {
    period: competition?.status?.period,
    clock:  competition?.status?.displayClock,
    homeScore: parseInt(competition?.competitors?.find(c => c.homeAway === 'home')?.score || 0),
    awayScore: parseInt(competition?.competitors?.find(c => c.homeAway === 'away')?.score || 0),
  };

  const homeTeam = data.boxscore.teams?.find(t => t.homeAway === 'home');
  const awayTeam = data.boxscore.teams?.find(t => t.homeAway === 'away');
  gameContext.totalPoints = getTeamStat(homeTeam, 'points') + getTeamStat(awayTeam, 'points');
  gameContext.scoreDiff   = Math.abs(gameContext.homeScore - gameContext.awayScore);

  return { players, gameContext };
}

function getTeamStat(team, statName) {
  if (!team?.statistics) return 0;
  const stat = team.statistics.find(s => s.name === statName);
  return parseInt(stat?.displayValue || '0') || 0;
}

// ─── Historical form ──────────────────────────────────────────────────────────

async function getHistoricalForm(sport, league, athleteId, gameDate) {
  const base = new Date(gameDate);
  const dates = Array.from({ length: 21 }, (_, i) => {
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
  for (const data of responses) {
    if (!data?.events) continue;
    for (const event of data.events) {
      if (event.status?.type?.completed) recentGameIds.push(event.id);
    }
  }

  if (recentGameIds.length === 0) return null;

  const formData = { byGame: [] };
  const BATCH = 8;

  for (let i = 0; i < recentGameIds.length && formData.byGame.length < 10; i += BATCH) {
    const batch = recentGameIds.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(gameId => extractPlayerGameLine(sport, league, gameId, athleteId))
    );
    for (const r of batchResults) {
      if (r && formData.byGame.length < 10) formData.byGame.push(r);
    }
  }

  if (formData.byGame.length === 0) return null;

  const calc = (games, stat) => {
    const vals = games.map(g => g.stats[stat]).filter(v => v != null && !isNaN(v));
    if (vals.length === 0) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };

  const last5  = formData.byGame.slice(0, 5);
  const last10 = formData.byGame.slice(0, 10);

  formData.averages = {
    last5:  Object.fromEntries(STAT_KEYS.map(s => [s, calc(last5, s)])),
    last10: Object.fromEntries(STAT_KEYS.map(s => [s, calc(last10, s)])),
  };

  const last3 = formData.byGame.slice(0, 3);
  const older = formData.byGame.slice(3, 10);
  formData.trends = {};
  for (const stat of STAT_KEYS) {
    const r = calc(last3, stat);
    const o = calc(older, stat);
    if (r == null || o == null || o === 0) { formData.trends[stat] = 'neutral'; continue; }
    if (r > o * 1.15)      formData.trends[stat] = 'up';
    else if (r < o * 0.85) formData.trends[stat] = 'down';
    else                   formData.trends[stat] = 'neutral';
  }

  return formData;
}

async function extractPlayerGameLine(sport, league, gameId, athleteId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${gameId}`;
    const summary = await fetchWithTimeout(url, 4000);
    if (!summary?.boxscore?.players) return null;

    for (const group of summary.boxscore.players) {
      const statsBlock = group.statistics?.[0];
      if (!statsBlock) continue;
      const keys = statsBlock.keys || [];
      const athlete = (statsBlock.athletes || []).find(a => String(a.athlete?.id) === String(athleteId));
      if (!athlete || !athlete.stats?.length) continue;

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

      return { gameId, stats, minutes };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Claude analysis ──────────────────────────────────────────────────────────

async function generatePicks(gameData, existingLegs = [], legCount = 4) {
  const { game, boxScore, historicalForms, seasonAverages, projections } = gameData;

  const isBlowout = boxScore.gameContext.scoreDiff >= 25;
  const totalPts  = boxScore.gameContext.totalPoints;
  const paceLabel = totalPts >= 60 ? 'HIGH pace' : totalPts >= 45 ? 'MEDIUM pace' : 'LOW pace (defensive)';
  const period    = boxScore.gameContext.period || 2;
  const clock     = boxScore.gameContext.clock || '';

  // Human-readable game phase for Claude
  const gamePhase = (() => {
    const desc = (boxScore.gameContext.statusDescription || '').toLowerCase();
    if (desc.includes('halftime')) return 'HALFTIME (between Q2 and Q3)';
    if (period === 1) return `Q1 -- ${clock} remaining`;
    if (period === 2) return `Q2 -- ${clock} remaining`;
    if (period === 3) return `Q3 -- ${clock} remaining`;
    if (period === 4) return `Q4 -- ${clock} remaining`;
    if (period > 4)   return `OT${period - 4} -- ${clock} remaining`;
    return `Period ${period}`;
  })();

  // Approximate minutes remaining in the game
  const parseClockMinutes = (clockStr) => {
    if (!clockStr) return null;
    const parts = clockStr.split(':');
    if (parts.length === 2) return parseFloat(parts[0]) + parseFloat(parts[1]) / 60;
    return null;
  };
  const clockMins = parseClockMinutes(clock);
  const quartersRemaining = Math.max(0, 4 - period);
  const approxMinsRemaining = clockMins != null
    ? Math.round((quartersRemaining * 12 + clockMins) * 10) / 10
    : quartersRemaining * 12;

  const playerLines = boxScore.players.map(p => {
    const form   = historicalForms[p.id];
    const season = seasonAverages[p.id];
    const proj   = projections[p.id];
    const s      = p.stats;

    const foulWarning = s.fouls >= 3 ? ' FOUL TROUBLE (3 fouls)' : s.fouls === 2 ? ' 2 fouls' : '';
    const minNote     = s.minutes < 8 ? ' (limited minutes)' : '';

    const statLine = [
      `${s.minutes}min`,
      `${s.points ?? 0}pts`,
      `${s.fieldGoalsMade ?? 0}/${(s.fieldGoalsAttempted ?? 0)} FG`,
      `${s.rebounds ?? 0}reb`,
      `${s.assists ?? 0}ast`,
      `${s.fouls ?? 0}pf`,
      s.plusMinus != null ? `${s.plusMinus > 0 ? '+' : ''}${s.plusMinus} +/-` : '',
    ].filter(Boolean).join(', ');

    let histLine = 'History: unavailable';
    if (form) {
      const p5  = form.averages.last5;
      const p10 = form.averages.last10;
      const trendPts = form.trends.points !== 'neutral'
        ? ` (${form.trends.points === 'up' ? 'TRENDING UP' : 'TRENDING DOWN'})`
        : '';
      histLine = `History: PTS L5=${p5.points ?? '?'} L10=${p10.points ?? '?'}${trendPts} | REB L5=${p5.rebounds ?? '?'} | AST L5=${p5.assists ?? '?'}`;
      if (p5.points != null && p10.points != null) {
        if (p5.points > p10.points * 1.2) histLine += ' HOT STRETCH';
        if (p5.points < p10.points * 0.8) histLine += ' COLD STRETCH';
      }
    }

    const projLine = proj
      ? formatProjectionForPrompt(p, proj, season)
      : '    Projections: insufficient data';

    return `  ${p.teamAbbrev} | ${p.name} (${p.position ?? '?'})${foulWarning}${minNote}
    Stats so far: ${statLine}
    ${histLine}
${projLine}`;
  }).join('\n\n');

  const existingLegsText = existingLegs.length > 0
    ? `\nEXISTING LEGS (exclude these players):\n${existingLegs.map((l, i) => `${i + 1}. ${l.player} - ${l.stat}`).join('\n')}\n`
    : '';

  const prompt = `You are an expert sports bettor specializing in live in-game prop analysis. You have access to the current box score, historical trends, AND mathematical rate-based projections for each player. Use all three layers to identify the strongest remaining-game props.

GAME: ${game.awayTeam?.name ?? 'Away'} @ ${game.homeTeam?.name ?? 'Home'}
CURRENT SCORE: ${game.awayTeam?.abbreviation ?? 'AWY'} ${boxScore.gameContext.awayScore} - ${boxScore.gameContext.homeScore} ${game.homeTeam?.abbreviation ?? 'HME'}
GAME PHASE: ${gamePhase}
APPROX MINUTES REMAINING: ~${approxMinsRemaining}
SCORE DIFFERENTIAL: ${boxScore.gameContext.scoreDiff}${isBlowout ? ' BLOWOUT -- starter pull risk' : ''}
PACE SO FAR: ${paceLabel} (${totalPts} combined pts)
${existingLegsText}
IMPORTANT -- GAME PHASE CONTEXT:
- If it is Q1 or early Q2: projections have high uncertainty -- large sample of remaining minutes so regression matters more, weight conservative projection heavily
- If it is Q2 or Halftime: standard projection confidence -- blended projection is most reliable
- If it is Q3: projections are tighter -- less time remaining means current pace is more predictive, weight aggressive projection slightly more
- If it is Q4 or OT: very few minutes remain -- only recommend picks where the player already has a strong base and needs relatively few more stats to clear the line. Blowout risk is highest here.
- Players in foul trouble in Q3/Q4 face higher risk than in Q1/Q2

PLAYER DATA (stats so far + historical form + projections):
${playerLines}

PROJECTION METHODOLOGY:
- "conservative" projection = first half value + (season per-min rate x projected remaining minutes)
- "blended" projection = regression-adjusted (weights current pace 55-70%, season rate 30-45%)
- "aggressive" projection = first half value + (current pace x projected remaining minutes)
- Projections already account for foul trouble and blowout minute reductions
- "vsExpected%" shows how their current pace compares to season norm (100% = exactly on pace)

HOW TO USE PROJECTIONS FOR PICKS:
- If blended projection is well above a typical prop line for that player -- strong Over candidate
- If blended projection is well below -- Under candidate or avoid
- A player at 180% of expected pace likely regresses -- prefer conservative projection
- A player at 75% of expected pace may rebound -- aggressive projection more credible
- High FG% vs season average -- regression risk on points, discount aggressive projection
- Low FG% vs season average -- positive regression likely, weight aggressive more

STAT SELECTION:
- Consider ALL stat types equally -- Points, Rebounds, Assists, Steals, Blocks are all valid picks
- Do not favour rebounds or assists over points -- if a player's blended points projection is strong, pick points
- Pick the stat where the projection offers the clearest edge over a typical sportsbook line

ADDITIONAL FACTORS:
- Foul trouble (3 fouls) = reduced minutes, strong risk flag
- Blowout (25+ diff) = starter pull risk for winning team in 4th
- High pace = counting stats inflated, verify the player is driving pace not just benefiting
- Players with 2 fouls in first half may play tentatively in 3rd quarter

THRESHOLD GUIDANCE (typical sportsbook lines for reference):
- Points: stars average 20-30, role players 8-15
- Rebounds: bigs average 8-12, wings 4-7
- Assists: playmakers average 6-10, wings 2-5

For each recommended pick provide:
- player: exact full name
- team: team abbreviation
- stat: one of "Points", "Rebounds", "Assists", "Steals", "Blocks"
- direction: "Over" or "Under"
- threshold: the number you are recommending betting Over/Under (based on blended projection minus a cushion for Over, or plus a cushion for Under)
- projection: the blended projection number for that stat
- rationale: 2-3 sentences grounded in the SPECIFIC projection numbers -- cite the blended projection
- rating: 1-5 stars (5 = projections align across all windows, no risk flags, clear edge)
- rating_reason: one sentence referencing the projection math
- risk_flags: array of concern strings (empty if clean)

Return ONLY valid JSON, no markdown:
{
  "game_summary": "2-3 sentences on game situation",
  "blowout_warning": true/false,
  "pace_note": "one sentence on pace implication",
  "picks": [
    {
      "player": "Full Name",
      "team": "ABV",
      "stat": "Points",
      "direction": "Over",
      "threshold": 18.5,
      "projection": 22.4,
      "rationale": "...",
      "rating": 4,
      "rating_reason": "...",
      "risk_flags": []
    }
  ]
}

Recommend exactly ${legCount} picks if ${legCount} strong options exist. Never pad -- quality over quantity. Consider all stat types equally.`;

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
    console.error('[halftime/analyze] JSON parse error:', parseErr.message);
    console.error('[halftime/analyze] Raw around error:', cleaned.substring(Math.max(0, parseInt(parseErr.message.match(/\d+/)?.[0] || 0) - 80), parseInt(parseErr.message.match(/\d+/)?.[0] || 0) + 80));
    // Attempt to salvage by stripping control characters and invalid escapes
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

  const { gameId, sport, league, homeTeam, awayTeam, existingLegs, legCount = 4 } = req.body;

  if (!gameId || !sport || !league) {
    return res.status(400).json({ error: 'Missing required fields: gameId, sport, league' });
  }

  try {
    console.log(`[halftime/analyze] Analyzing ${gameId} (${league.toUpperCase()})`);
    const today = new Date().toISOString().split('T')[0];

    // Step 1: Live box score
    const boxScoreData = await getLiveBoxScore(sport, league, gameId);
    if (!boxScoreData) {
      return res.status(404).json({ error: 'Could not fetch live box score' });
    }

    // Step 2: Filter to meaningful players
    const playersToAnalyze = boxScoreData.players
      .filter(p => p.starter || p.stats.minutes >= 8)
      .slice(0, 12);

    boxScoreData.players = playersToAnalyze;
    console.log(`[halftime/analyze] Analyzing ${playersToAnalyze.length} players`);

    // Step 3: Fetch historical form + season averages in parallel
    const [formResults, seasonResults] = await Promise.all([
      Promise.all(
        playersToAnalyze.map(p =>
          getHistoricalForm(sport, league, p.id, today).catch(() => null)
        )
      ),
      Promise.all(
        playersToAnalyze.map(p =>
          getSeasonAverages(sport, league, p.id).catch(() => null)
        )
      ),
    ]);

    const historicalForms = {};
    const seasonAverages  = {};
    playersToAnalyze.forEach((p, i) => {
      if (formResults[i])   historicalForms[p.id] = formResults[i];
      if (seasonResults[i]) seasonAverages[p.id]  = seasonResults[i];
    });

    console.log(`[halftime/analyze] Form: ${Object.keys(historicalForms).length}/${playersToAnalyze.length} | Season: ${Object.keys(seasonAverages).length}/${playersToAnalyze.length}`);

    // Step 4: Build projections
    const projections = {};
    for (const p of playersToAnalyze) {
      const proj = buildProjection(
        p,
        seasonAverages[p.id] || null,
        historicalForms[p.id] || null,
        boxScoreData.gameContext
      );
      if (proj) projections[p.id] = proj;
    }

    console.log(`[halftime/analyze] Built projections for ${Object.keys(projections).length} players`);

    // Build name-keyed projections for save-picks.js
    const projectionsByName = {};
    for (const p of playersToAnalyze) {
      if (projections[p.id]) projectionsByName[p.name] = projections[p.id];
    }

    // Step 5: Claude analysis
    const gameData = {
      game: { gameId, sport, league, homeTeam, awayTeam },
      boxScore: boxScoreData,
      historicalForms,
      seasonAverages,
      projections,
    };

    const picks = await generatePicks(gameData, existingLegs || [], legCount);

    // Attach projection numbers to each pick for the UI
    const picksWithProjections = (picks.picks || []).map(pick => {
      const player = playersToAnalyze.find(p => p.name === pick.player);
      const proj   = player ? projections[player.id] : null;
      const statKey = pick.stat?.toLowerCase();
      const blended = proj?.projections?.[statKey]?.blended ?? null;
      return {
        ...pick,
        projection: pick.projection ?? blended,
        threshold:  pick.threshold  ?? null,
        hasRealLine: false,
        model: 'claude-haiku-4-5-20251001',
      };
    });

    return res.status(200).json({
      success: true,
      gameId,
      game: { homeTeam, awayTeam, sport, league },
      ...picks,
      picks: picksWithProjections,
      projections: projectionsByName,
      analyzed_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[halftime/analyze] Error:', err.message);
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
