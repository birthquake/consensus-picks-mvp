// FILE LOCATION: api/halftime/analyze.js
// Given a live halftime game ID, pulls:
//   - Full first-half box score (points, minutes, FG, rebounds, assists, fouls, +/-)
//   - Each player's season avg, last 10 avg, last 5 avg for key stats
//   - Game context (pace, score differential, blowout risk)
// Then runs Claude to generate rated pick recommendations.
//
// Usage: POST /api/halftime/analyze
// Body: { gameId, sport, league, homeTeam, awayTeam, existingLegs? }

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STAT_KEYS = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers'];

const STAT_LABELS = {
  points: 'PTS', rebounds: 'REB', assists: 'AST',
  steals: 'STL', blocks: 'BLK', turnovers: 'TO',
};

// Box score stat key index map (matches ESPN summary boxscore keys array)
const BOX_KEY_MAP = {
  minutes: 'minutes',
  points: 'points',
  rebounds: 'rebounds',
  assists: 'assists',
  steals: 'steals',
  blocks: 'blocks',
  turnovers: 'turnovers',
  fouls: 'fouls',
  plusMinus: 'plusMinus',
  fieldGoalsMade: 'fieldGoalsMade-fieldGoalsAttempted',
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
    const teamId = group.team?.id;
    const teamAbbrev = group.team?.abbreviation;

    for (const athlete of (statsBlock.athletes || [])) {
      if (athlete.didNotPlay || !athlete.stats?.length) continue;

      // Must have played meaningful minutes (at least 3)
      const minutesIdx = keys.indexOf('minutes');
      const minutes = minutesIdx >= 0 ? parseFloat(athlete.stats[minutesIdx]) || 0 : 0;
      if (minutes < 3) continue;

      const playerStats = { minutes };

      // Extract all key stats
      for (const [statName, espnKey] of Object.entries(BOX_KEY_MAP)) {
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

  // Also grab game context
  const competition = data.header?.competitions?.[0];
  const gameContext = {
    period: competition?.status?.period,
    clock: competition?.status?.displayClock,
    homeScore: parseInt(competition?.competitors?.find(c => c.homeAway === 'home')?.score || 0),
    awayScore: parseInt(competition?.competitors?.find(c => c.homeAway === 'away')?.score || 0),
    // Pace proxy: total first-half points (higher = faster pace)
    totalPoints: players.reduce((sum, p) => p.teamId ? sum : sum, 0),
  };

  // Calculate total points from box score
  const homeTeam = data.boxscore.teams?.find(t => t.homeAway === 'home');
  const awayTeam = data.boxscore.teams?.find(t => t.homeAway === 'away');
  gameContext.totalPoints = getTeamStat(homeTeam, 'points') + getTeamStat(awayTeam, 'points');
  gameContext.scoreDiff = Math.abs(gameContext.homeScore - gameContext.awayScore);

  return { players, gameContext };
}

function getTeamStat(team, statName) {
  if (!team?.statistics) return 0;
  const stat = team.statistics.find(s => s.name === statName);
  return parseInt(stat?.displayValue || '0') || 0;
}

// ─── Historical form ──────────────────────────────────────────────────────────

async function getHistoricalForm(sport, league, athleteId, gameDate) {
  // Fetch recent game IDs by scanning past 21 days of scoreboards in parallel
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

  // Search game summaries in parallel batches
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

  // Calculate averages across windows
  const calc = (games, stat) => {
    const vals = games.map(g => g.stats[stat]).filter(v => v != null && !isNaN(v));
    if (vals.length === 0) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };

  const last5 = formData.byGame.slice(0, 5);
  const last10 = formData.byGame.slice(0, 10);

  formData.averages = {
    last5:  Object.fromEntries(STAT_KEYS.map(s => [s, calc(last5, s)])),
    last10: Object.fromEntries(STAT_KEYS.map(s => [s, calc(last10, s)])),
  };

  // Trend direction per stat: comparing last 3 vs games 4-10
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

      // Skip DNP games
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
  const { game, boxScore, historicalForms } = gameData;

  const isBlowout = boxScore.gameContext.scoreDiff >= 25;
  const isPace = boxScore.gameContext.totalPoints;
  const paceLabel = isPace >= 60 ? 'HIGH pace (lots of scoring)' : isPace >= 45 ? 'MEDIUM pace' : 'LOW pace (defensive game)';

  // Build per-player context block
  const playerLines = boxScore.players.map(p => {
    const form = historicalForms[p.id];
    const s = p.stats;

    const foulWarning = s.fouls >= 3 ? ' ⚠️ FOUL TROUBLE' : s.fouls >= 2 ? ' ⚡ 2 fouls' : '';
    const minNote = s.minutes < 10 ? ' (limited minutes so far)' : '';

    let histLine = '';
    if (form) {
      const pts5 = form.averages.last5.points;
      const pts10 = form.averages.last10.points;
      const reb5 = form.averages.last5.rebounds;
      const ast5 = form.averages.last5.assists;
      const trendPts = form.trends.points !== 'neutral' ? ` (${form.trends.points === 'up' ? '📈' : '📉'} trending)` : '';
      histLine = `    History: PTS avg L5=${pts5 ?? '?'} L10=${pts10 ?? '?'}${trendPts} | REB avg L5=${reb5 ?? '?'} | AST avg L5=${ast5 ?? '?'}`;

      // Flag if last5 is significantly above/below last10 for points
      if (pts5 != null && pts10 != null) {
        if (pts5 > pts10 * 1.2) histLine += ' 🔥 HOT STRETCH';
        if (pts5 < pts10 * 0.8) histLine += ' 🧊 COLD STRETCH';
      }
    } else {
      histLine = '    History: unavailable';
    }

    const statLine = [
      `${s.minutes}min`,
      `${s.points ?? 0}pts`,
      `${s.fieldGoalsMade ?? 0}/${(s.fieldGoalsMade ?? 0) + (s.fieldGoalsAttempted ?? 0)} FG`,
      `${s.rebounds ?? 0}reb`,
      `${s.assists ?? 0}ast`,
      `${s.fouls ?? 0}pf`,
      s.plusMinus != null ? `${s.plusMinus > 0 ? '+' : ''}${s.plusMinus} +/-` : '',
    ].filter(Boolean).join(', ');

    return `  ${p.teamAbbrev} | ${p.name} (${p.position ?? '?'})${foulWarning}${minNote}
    1st half: ${statLine}
${histLine}`;
  }).join('\n\n');

  const existingLegsText = existingLegs.length > 0
    ? `\nEXISTING LEGS ALREADY SELECTED (do not duplicate these players):\n${existingLegs.map((l, i) => `${i + 1}. ${l.player} - ${l.stat}`).join('\n')}\n`
    : '';

  const prompt = `You are an expert sports bettor specializing in live halftime prop analysis. Analyze this halftime game and recommend the strongest prop bet legs based on first-half performance and historical trends.

GAME: ${game.awayTeam.name} @ ${game.homeTeam.name}
SCORE: ${game.awayTeam.abbreviation} ${boxScore.gameContext.awayScore} - ${game.homeTeam.abbreviation} ${boxScore.gameContext.homeScore}
SCORE DIFF: ${boxScore.gameContext.scoreDiff} points${isBlowout ? ' ⚠️ BLOWOUT RISK — starters may get pulled' : ''}
FIRST HALF PACE: ${paceLabel} (${isPace} combined points)
${existingLegsText}
PLAYER FIRST-HALF STATS + HISTORICAL FORM (newest to oldest):
${playerLines}

ANALYSIS FRAMEWORK:
- Compare first-half pace to player's scoring average — are they on track to exceed season avg?
- Flag foul trouble (2+ fouls = reduced second-half minutes risk)
- Identify players who are "due" — hot historically but cold tonight (regression opportunity)
- Identify players running hot — performing above trend already this half
- High pace games favor counting stats (points, rebounds, assists) going over
- Blowout games (25+ point diff) risk garbage time — avoid trailing team's bench players
- A player with 3+ fouls in first half is a strong AVOID regardless of form
- Back-to-back game fatigue is a real factor — note if minutes are lower than usual

For each recommended leg, provide:
- player: exact full name
- team: team abbreviation
- stat: one of "Points", "Rebounds", "Assists", "Steals", "Blocks"
- direction: "Over" or "Under"
- rationale: 2-3 sentences grounded in specific numbers from the data above
- rating: 1-5 stars based on confidence (5 = multiple signals align, no red flags)
- rating_reason: one sentence explaining the star rating
- risk_flags: array of strings listing any concerns (empty array if none)

Return ONLY valid JSON, no markdown:
{
  "game_summary": "2-3 sentence overview of the game situation and what to watch",
  "blowout_warning": true or false,
  "pace_note": "one sentence about pace and its implication",
  "picks": [
    {
      "player": "Full Name",
      "team": "ABV",
      "stat": "Points",
      "direction": "Over",
      "rationale": "...",
      "rating": 4,
      "rating_reason": "...",
      "risk_flags": []
    }
  ]
}

Recommend exactly ${legCount} picks if ${legCount} strong options exist. If fewer than ${legCount} genuinely strong picks are available, recommend only those — never pad with weak picks just to hit the number. Rate honestly — a 2-star pick means real uncertainty. The user asked for ${legCount} legs, but quality beats quantity.`;

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 2000,
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

  const { gameId, sport, league, homeTeam, awayTeam, existingLegs, legCount = 4 } = req.body;

  if (!gameId || !sport || !league) {
    return res.status(400).json({ error: 'Missing required fields: gameId, sport, league' });
  }

  try {
    console.log(`[halftime/analyze] Analyzing game ${gameId} (${league.toUpperCase()})`);
    const today = new Date().toISOString().split('T')[0];

    // Fetch live box score + historical form in parallel
    const [boxScoreData, ...playerForms] = await Promise.all([
      getLiveBoxScore(sport, league, gameId),
      // Historical form will be fetched per-player after we have the box score
    ]);

    if (!boxScoreData) {
      return res.status(404).json({ error: 'Could not fetch live box score for this game' });
    }

    console.log(`[halftime/analyze] Got ${boxScoreData.players.length} active players`);

    // Fetch historical form for all players in parallel (capped at 12 players)
    const playersToAnalyze = boxScoreData.players
      .filter(p => p.starter || p.stats.minutes >= 8) // starters + key rotation players
      .slice(0, 12);

    const formResults = await Promise.all(
      playersToAnalyze.map(p =>
        getHistoricalForm(sport, league, p.id, today).catch(() => null)
      )
    );

    const historicalForms = {};
    playersToAnalyze.forEach((p, i) => {
      if (formResults[i]) historicalForms[p.id] = formResults[i];
    });

    console.log(`[halftime/analyze] Got historical form for ${Object.keys(historicalForms).length}/${playersToAnalyze.length} players`);

    // Filter box score players to analyzed set
    boxScoreData.players = playersToAnalyze;

    const gameData = {
      game: { gameId, sport, league, homeTeam, awayTeam },
      boxScore: boxScoreData,
      historicalForms,
    };

    const picks = await generatePicks(gameData, existingLegs || [], legCount);

    return res.status(200).json({
      success: true,
      gameId,
      game: { homeTeam, awayTeam, sport, league },
      ...picks,
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
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}
