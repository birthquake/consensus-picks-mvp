// FILE LOCATION: api/halftime/analyze-nfl.js
// Live in-game NFL prop pick generator — passing/rushing/receiving yards.
//
// Unlike api/halftime/analyze.js (NBA), NFL's live box score has no per-player
// "minutes" concept to pace remaining production off of — football is play-based,
// not clock-based per player. Instead we use GAME-elapsed fraction (from period +
// clock) to extrapolate each player's current pace to a full-game total, blended
// with their season average. The blend weight IS the elapsed fraction: early game
// leans on season avg (little live signal yet), late game leans on live pace
// (most of the game has already happened) — same regression-to-the-mean idea as
// the NBA file's REGRESSION_WEIGHT, just driven by game clock instead of a fixed
// per-stat weight.
//
// Box score structure (confirmed live against an in-progress game):
//   boxscore.players[] — one entry per team (team.id/abbreviation directly on it,
//     no separate team-ID lookup needed)
//   .statistics[] — array of CATEGORY blocks (passing/rushing/receiving/...),
//     each with its own .keys[] and .athletes[]. A player can appear in multiple
//     categories (a scrambling QB is in both passing and rushing; a pass-catching
//     RB is in both rushing and receiving) — merged into one record per player.
//   athlete.stats[] is positional against that category's keys[].

import Anthropic from '@anthropic-ai/sdk';
import { getTeamContext, getPassDefenseMultiplier, getRushDefenseMultiplier } from '../../lib/nfl-team-defense.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STAT_LABELS = {
  passingYards:   'Passing Yards',
  rushingYards:   'Rushing Yards',
  receivingYards: 'Receiving Yards',
};

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

// ─── Game clock math ──────────────────────────────────────────────────────────

function parseClock(clockStr) {
  if (!clockStr) return 0;
  const parts = clockStr.split(':');
  if (parts.length === 2) return parseFloat(parts[0]) + parseFloat(parts[1]) / 60;
  return 0;
}

function getElapsedFraction(period, clockStr) {
  const clockRemaining = parseClock(clockStr);
  const elapsedMinutes = Math.max(0, (period - 1) * 15 + (15 - clockRemaining));
  const fraction = elapsedMinutes / 60;
  return Math.max(0.08, Math.min(0.98, fraction));
}

// ─── Live box score parsing ───────────────────────────────────────────────────

function getLiveBoxScore(summary) {
  const groups = summary?.boxscore?.players ?? [];
  const playersById = {};

  for (const group of groups) {
    const teamId     = group.team?.id;
    const teamAbbrev = group.team?.abbreviation;

    for (const statsBlock of (group.statistics ?? [])) {
      const cat = statsBlock.name;
      if (!['passing', 'rushing', 'receiving'].includes(cat)) continue;

      const keys = statsBlock.keys ?? [];
      const get = (statsArr, key) => {
        const idx = keys.indexOf(key);
        if (idx === -1) return null;
        const v = parseFloat(statsArr[idx]);
        return isNaN(v) ? null : v;
      };

      for (const a of (statsBlock.athletes ?? [])) {
        const id = a.athlete?.id;
        if (!id) continue;
        const stats = a.stats ?? [];

        if (!playersById[id]) {
          playersById[id] = {
            id, name: a.athlete?.displayName, teamId, teamAbbrev,
            passingYards: null, rushingYards: null, receivingYards: null,
            rushingAttempts: null,
          };
        }
        const p = playersById[id];

        if (cat === 'passing')        p.passingYards   = get(stats, 'passingYards');
        else if (cat === 'rushing')  { p.rushingYards   = get(stats, 'rushingYards'); p.rushingAttempts = get(stats, 'rushingAttempts'); }
        else if (cat === 'receiving')  p.receivingYards = get(stats, 'receivingYards');
      }
    }
  }

  const competition = summary?.header?.competitions?.[0];
  const status  = competition?.status;
  const homeC   = competition?.competitors?.find(c => c.homeAway === 'home');
  const awayC   = competition?.competitors?.find(c => c.homeAway === 'away');

  return {
    players: Object.values(playersById),
    gameContext: {
      period:             status?.period ?? 1,
      clock:              status?.displayClock ?? '15:00',
      statusDescription:  status?.type?.description ?? '',
      homeTeamId:         homeC?.team?.id,
      awayTeamId:         awayC?.team?.id,
      homeScore:          parseInt(homeC?.score || '0'),
      awayScore:          parseInt(awayC?.score || '0'),
    },
  };
}

// ─── Season averages ──────────────────────────────────────────────────────────

async function getSeasonAverage(playerId) {
  const data = await fetchWithTimeout(
    `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${playerId}/gamelog`, 5000
  );
  if (!data) return {};

  const colNames = data.names ?? [];
  if (!colNames.length) return {};

  let category = null;
  for (const st of data?.seasonTypes ?? []) {
    for (const c of st?.categories ?? []) {
      if ((c?.events ?? []).length > 0) { category = c; break; }
    }
    if (category) break;
  }
  if (!category) return {};

  const events = category.events ?? [];
  if (!events.length) return {};

  const get = (statsArr, name) => {
    const idx = colNames.indexOf(name);
    if (idx === -1) return 0;
    return parseFloat(statsArr[idx]) || 0;
  };

  const sums = { passingYards: 0, rushingYards: 0, receivingYards: 0 };
  for (const ev of events) {
    const s = ev?.stats ?? [];
    sums.passingYards   += get(s, 'passingYards');
    sums.rushingYards   += get(s, 'rushingYards');
    sums.receivingYards += get(s, 'receivingYards');
  }
  const n = events.length;
  return {
    passingYards:   sums.passingYards / n,
    rushingYards:   sums.rushingYards / n,
    receivingYards: sums.receivingYards / n,
  };
}

// ─── Game-script (trailing/leading) adjustment ────────────────────────────────
// Trailing teams pass more to catch up; leading teams run more to control the
// clock. A real, well-known football effect the NBA file has no equivalent for
// (its blowoutReduction is about players losing minutes, not play-calling shift).

function getGameScriptMultiplier(statType, teamId, gameContext) {
  const { period, homeScore, awayScore, homeTeamId, awayTeamId } = gameContext;
  if (period < 3) return 1.0;

  const scoreDiff = homeScore - awayScore; // positive = home leading
  const margin = Math.abs(scoreDiff);
  if (margin < 14) return 1.0;

  const homeLeading = scoreDiff > 0;
  const isHomeTeam  = String(teamId) === String(homeTeamId);
  const isLeading   = isHomeTeam ? homeLeading : !homeLeading;
  const isPassStat  = statType === 'passingYards' || statType === 'receivingYards';

  if (isLeading) return isPassStat ? 0.90 : 1.10; // clock control
  return isPassStat ? 1.10 : 0.90;                // catch-up mode
}

// ─── Projection ───────────────────────────────────────────────────────────────

function buildLiveProjection(player, stat, elapsedFraction, seasonAvg, oppMult, scriptMult) {
  const currentValue = player[stat];
  if (currentValue == null) return null;

  const paceProjection = currentValue / elapsedFraction;
  const season = seasonAvg?.[stat] ?? paceProjection;

  let blended = (paceProjection * elapsedFraction) + (season * (1 - elapsedFraction));
  blended *= oppMult * scriptMult;
  blended = Math.max(blended, currentValue); // can't project below what's already happened

  return {
    currentValue,
    paceProjection: Math.round(paceProjection * 10) / 10,
    seasonAvg:      Math.round(season * 10) / 10,
    blended:        Math.round(blended * 10) / 10,
    oppMult:        Math.round(oppMult * 100) / 100,
    scriptMult:     Math.round(scriptMult * 100) / 100,
  };
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

function formatPlayerForPrompt(p, projections) {
  const lines = [`${p.teamAbbrev} | ${p.name}`];
  for (const stat of Object.keys(projections)) {
    const proj = projections[stat];
    if (!proj) continue;
    const label = STAT_LABELS[stat] ?? stat;
    const oppNote    = proj.oppMult !== 1.0    ? ` | opp defense mult: ${proj.oppMult}x` : '';
    const scriptNote = proj.scriptMult !== 1.0 ? ` | game-script mult: ${proj.scriptMult}x` : '';
    lines.push(`  ${label.toUpperCase()}: ${proj.currentValue} so far -> full-game pace ${proj.paceProjection} | season avg ${proj.seasonAvg} | blended projection ${proj.blended}${oppNote}${scriptNote}`);
  }
  return lines.join('\n');
}

async function generateLivePicks(game, playerLines, gameContext, existingLegs, legCount) {
  const gamePhase = (() => {
    const desc = (gameContext.statusDescription || '').toLowerCase();
    if (desc.includes('halftime')) return 'HALFTIME';
    if (gameContext.period <= 4) return `Q${gameContext.period} -- ${gameContext.clock} remaining`;
    return `OT -- ${gameContext.clock} remaining`;
  })();

  const existingLegsText = existingLegs.length > 0
    ? `\nEXISTING LEGS (exclude these players):\n${existingLegs.map((l, i) => `${i + 1}. ${l.player} - ${l.stat}`).join('\n')}\n`
    : '';

  const prompt = `You are an expert sports bettor specializing in live in-game NFL prop analysis.

GAME: ${game.awayTeam} @ ${game.homeTeam}
SCORE: ${game.awayTeam} ${gameContext.awayScore} - ${gameContext.homeScore} ${game.homeTeam}
GAME PHASE: ${gamePhase}
${existingLegsText}
PLAYER DATA (live stats so far + full-game projections):
${playerLines}

PROJECTION METHODOLOGY:
- "full-game pace" = current value extrapolated at the same rate for the whole game
- "blended projection" = weighted mix of pace and season average (early game leans on season avg, late game leans on live pace), already adjusted for opponent defense strength and game-script (trailing teams pass more, leading teams run more)
- Opponent defense mult / game-script mult are already baked into the blended projection -- cite them when meaningful (>1.08 or <0.92)

HOW TO USE:
- Recommend Over when blended projection clearly exceeds a realistic full-game threshold for that player/stat
- A player already near or above a typical full-game total with real time left is a strong Over
- Early game (Q1) projections carry more uncertainty -- weight season average more, be conservative
- Late game (Q4) projections are tighter -- current pace is more predictive

For each pick:
- player, team, stat (one of "Passing Yards", "Rushing Yards", "Receiving Yards")
- direction ("Over" or "Under"), threshold (the number you're recommending), projection
- rationale: 1-2 sentences citing specific numbers
- rating: 1-5 stars based on how strong and well-supported the edge is
- rating_reason: one sentence
- risk_flags: array of concerns (empty if clean)

Return ONLY valid JSON, no markdown:
{
  "game_summary": "1-2 sentences on the game situation",
  "picks": [
    { "player": "Full Name", "team": "ABV", "stat": "Passing Yards", "direction": "Over", "threshold": 245.5, "projection": 278.2, "rationale": "...", "rating": 4, "rating_reason": "...", "risk_flags": [] }
  ]
}

Recommend exactly ${legCount} picks if ${legCount} strong options exist. Never pad with weak picks.`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const jsonStart = raw.indexOf('{');
  const jsonEnd   = raw.lastIndexOf('}');
  const cleaned   = jsonStart !== -1 && jsonEnd !== -1 ? raw.substring(jsonStart, jsonEnd + 1) : raw;

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[halftime/analyze-nfl] JSON parse error:', err.message);
    throw new Error(`Claude response JSON parse failed: ${err.message}`);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameId, homeTeam, awayTeam, existingLegs, legCount = 4 } = req.body;
  if (!gameId) return res.status(400).json({ error: 'Missing required field: gameId' });

  try {
    const summary = await fetchWithTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`, 6000
    );
    if (!summary) return res.status(404).json({ error: 'Could not fetch live game data' });

    const { players, gameContext } = getLiveBoxScore(summary);
    if (players.length === 0) {
      return res.status(404).json({ error: 'No live player stats available yet for this game' });
    }

    const [homeCtx, awayCtx] = await Promise.all([
      gameContext.homeTeamId ? getTeamContext(gameContext.homeTeamId, new Date().toISOString()).catch(() => null) : null,
      gameContext.awayTeamId ? getTeamContext(gameContext.awayTeamId, new Date().toISOString()).catch(() => null) : null,
    ]);

    const elapsedFraction = getElapsedFraction(gameContext.period, gameContext.clock);
    const seasonAvgs = await Promise.all(players.map(p => getSeasonAverage(p.id).catch(() => ({}))));

    const playerLines = [];
    const projByPlayer = {};

    players.forEach((p, i) => {
      const seasonAvg    = seasonAvgs[i];
      const isHomePlayer = String(p.teamId) === String(gameContext.homeTeamId);
      // Faces the OTHER team's defense
      const oppDefenseAllowed = isHomePlayer ? awayCtx?.defenseAllowed : homeCtx?.defenseAllowed;

      const projections = {};

      if (p.passingYards != null) {
        const oppMult    = getPassDefenseMultiplier(oppDefenseAllowed);
        const scriptMult = getGameScriptMultiplier('passingYards', p.teamId, gameContext);
        projections.passingYards = buildLiveProjection(p, 'passingYards', elapsedFraction, seasonAvg, oppMult, scriptMult);
      }
      if (p.rushingYards != null && (p.passingYards == null || (p.rushingAttempts ?? 0) >= 2)) {
        const oppMult    = getRushDefenseMultiplier(oppDefenseAllowed);
        const scriptMult = getGameScriptMultiplier('rushingYards', p.teamId, gameContext);
        projections.rushingYards = buildLiveProjection(p, 'rushingYards', elapsedFraction, seasonAvg, oppMult, scriptMult);
      }
      if (p.receivingYards != null) {
        const oppMult    = getPassDefenseMultiplier(oppDefenseAllowed);
        const scriptMult = getGameScriptMultiplier('receivingYards', p.teamId, gameContext);
        projections.receivingYards = buildLiveProjection(p, 'receivingYards', elapsedFraction, seasonAvg, oppMult, scriptMult);
      }

      if (Object.keys(projections).length === 0) return;

      projByPlayer[p.name] = projections;
      playerLines.push(formatPlayerForPrompt(p, projections));
    });

    if (playerLines.length === 0) {
      return res.status(404).json({ error: 'No players with usable live stats yet' });
    }

    const picks = await generateLivePicks(
      { homeTeam, awayTeam },
      playerLines.join('\n\n'),
      gameContext,
      existingLegs || [],
      legCount
    );

    const picksWithMeta = (picks.picks || []).map(p => ({
      ...p, hasRealLine: false, model: 'claude-haiku-4-5-20251001', sport: 'nfl',
    }));

    return res.status(200).json({
      success: true,
      gameId,
      game: { homeTeam, awayTeam, sport: 'football', league: 'nfl' },
      ...picks,
      picks: picksWithMeta,
      projections: projByPlayer,
      analyzed_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[halftime/analyze-nfl] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
