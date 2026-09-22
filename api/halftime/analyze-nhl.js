// FILE LOCATION: api/halftime/analyze-nhl.js
// Live in-game NHL prop pick generator — shots/points/goals/assists
// (skaters), saves (goalies).
//
// Matches the depth of the pregame NHL analyzer, not just live pace: reuses
// opponent shots/goals-allowed strength and back-to-back/rest detection from
// the same lib/nhl-team-defense.js module api/pregame/analyze-nhl.js uses,
// blended with a live in-game pacing model.
//
// Live pacing model: time on ice (timeOnIce, directly in the live box score)
// is hockey's literal analog to NBA's "minutes played" — current rate
// (stat / TOI-so-far) is blended with season rate, weighted by how much of a
// typical game's TOI the player has already used, then projected over the
// remaining TOI. Same shape as api/halftime/analyze-mlb.js's AB-based model
// and every other live analyzer in this app.
//
// Box score structure (confirmed live/recent game): boxscore.players[] per
// team, grouped into named categories: `forwards`, `defenses` (both
// skaters), `goalies`. No live "likely backup" uncertainty needed the way
// pregame has it — the box score already shows who's actually in net.

import Anthropic from '@anthropic-ai/sdk';
import { NHL_AVG, getTeamDefenseStats, getTeamSchedule, parseTOI } from '../../lib/nhl-team-defense.js';

const client = new Anthropic();

const SKATER_STATS = ['shots', 'points', 'goals', 'assists'];
const GOALIE_STATS  = ['saves'];

const STAT_LABELS = {
  shots: 'Shots', points: 'Points', goals: 'Goals', assists: 'Assists', saves: 'Saves',
};

async function fetchJSON(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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

// ─── Live box score parsing ───────────────────────────────────────────────────

function getLiveBoxScore(summary) {
  const groups  = summary?.boxscore?.players ?? [];
  const players = [];

  for (const group of groups) {
    const teamId     = group.team?.id;
    const teamAbbrev = group.team?.abbreviation;

    for (const statsBlock of (group.statistics ?? [])) {
      const cat  = statsBlock.name; // 'forwards' | 'defenses' | 'skaters' | 'goalies'
      const keys = statsBlock.keys ?? [];
      if (!['forwards', 'defenses', 'goalies'].includes(cat)) continue;

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
        const toi = parseTOI(stats[keys.indexOf('timeOnIce')]);

        if (cat === 'goalies') {
          players.push({
            id, name: a.athlete?.displayName, teamId, teamAbbrev, isGoalie: true,
            toi, saves: get(stats, 'saves') ?? 0,
            shotsAgainst: get(stats, 'shotsAgainst') ?? 0,
            goalsAgainst: get(stats, 'goalsAgainst') ?? 0,
          });
        } else {
          const goals   = get(stats, 'goals') ?? 0;
          const assists = get(stats, 'assists') ?? 0;
          players.push({
            id, name: a.athlete?.displayName, teamId, teamAbbrev, isGoalie: false,
            isDefenseman: cat === 'defenses',
            toi, goals, assists, points: goals + assists,
            shots: get(stats, 'shotsTotal') ?? 0,
          });
        }
      }
    }
  }

  const competition = summary?.header?.competitions?.[0];
  const status = competition?.status;
  const homeC  = competition?.competitors?.find(c => c.homeAway === 'home');
  const awayC  = competition?.competitors?.find(c => c.homeAway === 'away');

  return {
    players,
    gameContext: {
      period:      status?.period ?? 1,
      clock:       status?.displayClock ?? '20:00',
      statusDescription: status?.type?.detail ?? status?.type?.description ?? '',
      homeTeamId:  homeC?.team?.id,
      awayTeamId:  awayC?.team?.id,
      homeAbbrev:  homeC?.team?.abbreviation,
      awayAbbrev:  awayC?.team?.abbreviation,
      homeScore:   parseInt(homeC?.score || '0'),
      awayScore:   parseInt(awayC?.score || '0'),
    },
  };
}

// ─── Season averages (own compact fetcher, self-contained per the halftime-
// family convention) ───────────────────────────────────────────────────────

async function getSeasonAverage(playerId, isGoalie) {
  const data = await fetchJSON(
    `https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/${playerId}/gamelog`
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

  const getStat = (statsArr, name) => {
    const idx = colNames.indexOf(name);
    if (idx === -1) return 0;
    return parseFloat(statsArr[idx]) || 0;
  };

  if (isGoalie) {
    let toiSum = 0, savesSum = 0, saSum = 0, gaSum = 0, n = 0;
    for (const ev of events) {
      const s = ev?.stats ?? [];
      const toi = parseTOI(s[colNames.indexOf('timeOnIcePerGame')]);
      if (toi <= 0) continue;
      toiSum += toi;
      savesSum += getStat(s, 'saves');
      saSum += getStat(s, 'shotsAgainst');
      gaSum += getStat(s, 'goalsAgainst');
      n++;
    }
    if (n === 0) return {};
    return { toi: toiSum / n, saves: savesSum / n, shotsAgainst: saSum / n, goalsAgainst: gaSum / n };
  }

  let toiSum = 0, shotsSum = 0, pointsSum = 0, goalsSum = 0, assistsSum = 0, n = 0;
  for (const ev of events) {
    const s = ev?.stats ?? [];
    const toi = parseTOI(s[colNames.indexOf('timeOnIcePerGame')]);
    if (toi <= 0) continue;
    toiSum += toi;
    shotsSum += getStat(s, 'shotsTotal');
    const g = getStat(s, 'goals'), a = getStat(s, 'assists');
    goalsSum += g; assistsSum += a; pointsSum += (g + a);
    n++;
  }
  if (n === 0) return {};
  return { toi: toiSum / n, shots: shotsSum / n, points: pointsSum / n, goals: goalsSum / n, assists: assistsSum / n };
}

// ─── Live pacing projection ───────────────────────────────────────────────────

function buildLiveProjection(player, stat, seasonAvg, contextMult) {
  const currentValue = player[stat] ?? 0;
  const toiSoFar   = player.toi ?? 0;
  const seasonTOI  = seasonAvg.toi;
  const seasonRate = (seasonTOI && seasonAvg[stat] != null) ? seasonAvg[stat] / seasonTOI : null;
  const currentRate = toiSoFar > 0 ? currentValue / toiSoFar : null;

  const elapsedFraction = seasonTOI ? Math.max(0.05, Math.min(1, toiSoFar / seasonTOI)) : 0.5;
  const blendedRate = currentRate != null
    ? (currentRate * elapsedFraction) + ((seasonRate ?? currentRate) * (1 - elapsedFraction))
    : (seasonRate ?? 0);

  const remainingTOI = Math.max(0, (seasonTOI ?? toiSoFar) - toiSoFar);

  let blended = currentValue + blendedRate * remainingTOI;
  blended *= contextMult;
  blended = Math.max(blended, currentValue);

  return {
    currentValue,
    toiSoFar: Math.round(toiSoFar * 10) / 10,
    seasonTOI: seasonTOI ? Math.round(seasonTOI * 10) / 10 : null,
    blended: Math.round(blended * 10) / 10,
    contextMult: Math.round(contextMult * 100) / 100,
  };
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

function formatPlayerForPrompt(p, projections) {
  const posNote = p.isGoalie ? 'G' : p.isDefenseman ? 'D' : 'F';
  const lines = [`${p.teamAbbrev} | ${p.name} (${posNote})`];
  for (const stat of Object.keys(projections)) {
    const proj = projections[stat];
    if (!proj) continue;
    const label = STAT_LABELS[stat] ?? stat;
    const multNote = proj.contextMult !== 1.0 ? ` | opp/rest mult: ${proj.contextMult}x` : '';
    lines.push(`  ${label.toUpperCase()}: ${proj.currentValue} so far (TOI ${proj.toiSoFar}min) -> full-game projection ${proj.blended}${multNote}`);
  }
  return lines.join('\n');
}

async function generateLivePicks(game, playerLines, gameContext, existingLegs, legCount) {
  const gamePhase = (() => {
    const desc = (gameContext.statusDescription || '').toLowerCase();
    if (desc.includes('intermission')) return 'INTERMISSION';
    if (gameContext.period <= 3) return `P${gameContext.period} -- ${gameContext.clock} remaining`;
    return `OT -- ${gameContext.clock} remaining`;
  })();

  const existingLegsText = existingLegs.length > 0
    ? `\nEXISTING LEGS (exclude these players):\n${existingLegs.map((l, i) => `${i + 1}. ${l.player} - ${l.stat}`).join('\n')}\n`
    : '';

  const prompt = `You are an expert sports bettor specializing in live in-game NHL prop analysis.

GAME: ${game.awayTeam} @ ${game.homeTeam}
SCORE: ${game.awayTeam} ${gameContext.awayScore} - ${gameContext.homeScore} ${game.homeTeam}
GAME PHASE: ${gamePhase}
${existingLegsText}
PLAYER DATA (live stats so far + full-game projections):
${playerLines}

PROJECTION METHODOLOGY:
- "full-game projection" blends current-game rate (per minute of ice time) with season rate, weighted by how much of a typical game's TOI the player has already used, then projects the rest
- Context multiplier already applied: opponent shots/goals-allowed strength and back-to-back fatigue -- cite when meaningful (>1.08 or <0.92)

HOW TO USE:
- Recommend Over when the full-game projection clearly exceeds a realistic full-game threshold
- Early periods (P1): high uncertainty, weight season rate more
- Late periods (P3+): current pace is more predictive, especially for players getting heavy ice time
- Defensemen (D) have fewer scoring opportunities -- weight shots over points for them
- Goalies: use saves as the primary prop; shots-against pace matters more than TOI for backup-goalie starts

For each pick:
- player, team, stat (one of: "Shots", "Points", "Goals", "Assists", "Saves")
- direction ("Over" or "Under"), threshold (the number you're recommending), projection
- rationale: 1-2 sentences citing specific numbers
- rating: 1-5 stars based on how strong and well-supported the edge is
- rating_reason: one sentence
- risk_flags: array of concerns (empty if clean)

Return ONLY valid JSON, no markdown:
{
  "game_summary": "1-2 sentences on the game situation",
  "picks": [
    { "player": "Full Name", "team": "ABV", "stat": "Shots", "direction": "Over", "threshold": 2.5, "projection": 3.4, "rationale": "...", "rating": 4, "rating_reason": "...", "risk_flags": [] }
  ]
}

Recommend exactly ${legCount} picks if ${legCount} strong options exist. Never pad with weak picks.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const jsonStart = raw.indexOf('{');
  const jsonEnd   = raw.lastIndexOf('}');
  const cleaned   = jsonStart !== -1 && jsonEnd !== -1 ? raw.substring(jsonStart, jsonEnd + 1) : raw;

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[halftime/analyze-nhl] JSON parse error:', err.message);
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
    const summary = await fetchJSON(
      `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${gameId}`
    );
    if (!summary) return res.status(404).json({ error: 'Could not fetch live game data' });

    const { players, gameContext } = getLiveBoxScore(summary);
    if (players.length === 0) {
      return res.status(404).json({ error: 'No live player stats available yet for this game' });
    }

    const [homeDefense, awayDefense, homeSchedule, awaySchedule] = await Promise.all([
      gameContext.homeTeamId ? getTeamDefenseStats(gameContext.homeTeamId).catch(() => null) : null,
      gameContext.awayTeamId ? getTeamDefenseStats(gameContext.awayTeamId).catch(() => null) : null,
      gameContext.homeTeamId ? getTeamSchedule(gameContext.homeTeamId).catch(() => null) : null,
      gameContext.awayTeamId ? getTeamSchedule(gameContext.awayTeamId).catch(() => null) : null,
    ]);
    const homeB2B = homeSchedule?.isBackToBack ?? false;
    const awayB2B = awaySchedule?.isBackToBack ?? false;

    const seasonAvgs = await Promise.all(players.map(p => getSeasonAverage(p.id, p.isGoalie).catch(() => ({}))));

    const playerLines = [];
    const projByPlayer = {};

    players.forEach((p, i) => {
      const seasonAvg = seasonAvgs[i];
      const isHomePlayer = String(p.teamId) === String(gameContext.homeTeamId);
      // Faces the OTHER team's defense; fatigue is this player's OWN team's B2B status
      const oppDefense = isHomePlayer ? awayDefense : homeDefense;
      const isB2B      = isHomePlayer ? homeB2B : awayB2B;
      const b2bMult     = isB2B ? 0.93 : 1.0;

      const projections = {};

      if (p.isGoalie) {
        let oppPressureMult = 1.0;
        if (oppDefense?.shotsAgainstPG && NHL_AVG.shotsAgainstPerGame > 0) {
          oppPressureMult = Math.max(0.85, Math.min(1.15, oppDefense.shotsAgainstPG / NHL_AVG.shotsAgainstPerGame));
        }
        for (const stat of GOALIE_STATS) {
          projections[stat] = buildLiveProjection(p, stat, seasonAvg, oppPressureMult * b2bMult);
        }
      } else {
        let oppShotMult = 1.0, oppScoreMult = 1.0;
        if (oppDefense?.shotsAgainstPG && NHL_AVG.shotsAgainstPerGame > 0) {
          oppShotMult = Math.max(0.8, Math.min(1.2, oppDefense.shotsAgainstPG / NHL_AVG.shotsAgainstPerGame));
        }
        if (oppDefense?.goalsAgainstPG && NHL_AVG.goalsAgainstPerGame > 0) {
          oppScoreMult = Math.max(0.8, Math.min(1.2, oppDefense.goalsAgainstPG / NHL_AVG.goalsAgainstPerGame));
        }
        const dWeight = p.isDefenseman ? 0.85 : 1.0; // defensemen produce fewer points/goals

        for (const stat of SKATER_STATS) {
          const oppMult = stat === 'shots' ? oppShotMult : oppScoreMult;
          const posMult = stat === 'shots' ? 1.0 : dWeight;
          projections[stat] = buildLiveProjection(p, stat, seasonAvg, oppMult * posMult * b2bMult);
        }
      }

      for (const stat of Object.keys(projections)) {
        if (projections[stat].blended <= projections[stat].currentValue) delete projections[stat];
      }
      if (Object.keys(projections).length === 0) return;

      projByPlayer[p.name] = projections;
      playerLines.push(formatPlayerForPrompt(p, projections));
    });

    if (playerLines.length === 0) {
      return res.status(404).json({ error: 'No players with usable live stats yet' });
    }

    const picks = await generateLivePicks(
      { homeTeam: homeTeam || gameContext.homeAbbrev, awayTeam: awayTeam || gameContext.awayAbbrev },
      playerLines.join('\n\n'),
      gameContext,
      existingLegs || [],
      legCount
    );

    const picksWithMeta = (picks.picks || []).map(p => ({
      ...p, hasRealLine: false, model: 'claude-haiku-4-5-20251001', sport: 'nhl',
    }));

    return res.status(200).json({
      success: true,
      gameId,
      game: { homeTeam: homeTeam || gameContext.homeAbbrev, awayTeam: awayTeam || gameContext.awayAbbrev, sport: 'hockey', league: 'nhl' },
      ...picks,
      picks: picksWithMeta,
      projections: projByPlayer,
      analyzed_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[halftime/analyze-nhl] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
