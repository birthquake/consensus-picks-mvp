// FILE LOCATION: api/halftime/analyze-mlb.js
// Live in-game MLB prop pick generator — hits/home runs/RBI/runs/H+R+RBI
// (batters), strikeouts/outs recorded/walks (pitchers).
//
// Matches the depth of the pregame MLB analyzer, not just live pace: reuses
// park factors, opponent team ERA, sabermetrics (batter/pitcher multipliers),
// and weather from the same lib/ modules api/pregame/analyze-mlb.js uses,
// blended with a live in-game pacing model.
//
// Live pacing model: baseball has no "minutes played" the way basketball
// does, but at-bats (batters) and outs recorded (pitchers) are the exact
// analog — both are directly available in the live box score. Current rate
// (stat / units-so-far) is blended with season rate, weighted by how much of
// a typical game's workload the player has already used (elapsedFraction =
// unitsSoFar / seasonUnitsPerGame), then projected over the remaining units.
// Same regression-to-the-mean shape as every other live analyzer in this app.
//
// Box score structure (confirmed live): boxscore.players[] per team, each
// with 2 stat blocks. The `name` field is null on both — identified instead
// by key signature (batting block has `atBats`, pitching has `ERA`).
// Batting order slot is inferred for free from position within the box
// score's batter list (already lineup-sequenced) — no separate
// lineup-confirmation fetch needed live, unlike pregame.
//
// NOT included: Total Bases prop — the live box score has no 2B/3B
// breakdown, only aggregate hits, so total bases can't be derived accurately
// mid-game (pregame gets it from the season gamelog, which does have it).

import Anthropic from '@anthropic-ai/sdk';
import {
  getSabermetrics,
  getPitcherSabermetrics,
  getSabermetricMultiplier,
  getPitcherMultiplierForBatters,
} from '../../lib/sabermetrics.js';
import { getGameWeather, getWeatherMultiplier } from '../../lib/weather.js';
import { getParkFactor, getTeamPitchingStats, getLineupMultiplier } from '../../lib/mlb-team-context.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BATTER_STATS  = ['hits', 'homeRuns', 'rbi', 'runs', 'hra'];
const PITCHER_STATS = ['strikeouts', 'outsRecorded', 'walks'];

const STAT_LABELS = {
  hits: 'Hits', homeRuns: 'Home Runs', rbi: 'RBI', runs: 'Runs', hra: 'H+R+RBI',
  strikeouts: 'Strikeouts', outsRecorded: 'Outs Recorded', walks: 'Walks',
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

// "5.1" -> 5 full innings + 1 out = 5.33 innings (standard baseball notation:
// decimal is outs into the next inning, not tenths)
function parseInnings(ip) {
  if (ip == null) return null;
  const n = parseFloat(ip);
  if (isNaN(n)) return null;
  const full = Math.floor(n);
  const partial = Math.round((n - full) * 10);
  return full + (partial / 3);
}

// ─── Live box score parsing ───────────────────────────────────────────────────

function getLiveBoxScore(summary) {
  const groups  = summary?.boxscore?.players ?? [];
  const players = [];

  for (const group of groups) {
    const teamId     = group.team?.id;
    const teamAbbrev = group.team?.abbreviation;

    for (const statsBlock of (group.statistics ?? [])) {
      const keys = statsBlock.keys ?? [];
      const isBatting  = keys.includes('atBats');
      const isPitching = keys.includes('ERA');
      if (!isBatting && !isPitching) continue;

      const get = (statsArr, key) => {
        const idx = keys.indexOf(key);
        if (idx === -1) return null;
        const v = parseFloat(statsArr[idx]);
        return isNaN(v) ? null : v;
      };

      (statsBlock.athletes ?? []).forEach((a, order) => {
        const id = a.athlete?.id;
        if (!id) return;
        const stats = a.stats ?? [];

        if (isBatting) {
          const hits = get(stats, 'hits') ?? 0;
          const runs = get(stats, 'runs') ?? 0;
          const rbi  = get(stats, 'RBIs') ?? 0;
          players.push({
            id, name: a.athlete?.displayName, teamId, teamAbbrev, isPitcher: false,
            battingOrderSlot: order < 9 ? order + 1 : null,
            atBats: get(stats, 'atBats') ?? 0,
            hits, homeRuns: get(stats, 'homeRuns') ?? 0, rbi, runs, hra: hits + runs + rbi,
          });
        } else {
          const ip = parseInnings(get(stats, 'fullInnings.partInnings'));
          players.push({
            id, name: a.athlete?.displayName, teamId, teamAbbrev, isPitcher: true,
            outsRecorded: ip != null ? Math.round(ip * 3) : 0,
            strikeouts: get(stats, 'strikeouts') ?? 0,
            walks: get(stats, 'walks') ?? 0,
          });
        }
      });
    }
  }

  const competition = summary?.header?.competitions?.[0];
  const status = competition?.status;
  const homeC  = competition?.competitors?.find(c => c.homeAway === 'home');
  const awayC  = competition?.competitors?.find(c => c.homeAway === 'away');

  return {
    players,
    gameContext: {
      inning:      status?.period ?? 1,
      half:        status?.periodPrefix ?? 'Top',
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

// ─── Season averages (own compact fetcher — tracks AB/outs, which the
// pregame gamelog fetch doesn't retain) ───────────────────────────────────────

async function getSeasonAverage(playerId, isPitcher) {
  const data = await fetchWithTimeout(
    `https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${playerId}/gamelog`, 5000
  );
  if (!data) return {};

  const names = data.names ?? [];
  if (!names.length) return {};
  const categories = data.seasonTypes?.[0]?.categories ?? [];

  const colIdx = (...candidates) => {
    for (const c of candidates) {
      const i = names.findIndex(n => n === c || n.toLowerCase() === c.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const parseS = (statsArr, i) => {
    if (i < 0 || i >= statsArr.length) return null;
    const s = String(statsArr[i]);
    if (s === '--' || s === '-' || s === '') return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  if (isPitcher) {
    const IP_I = colIdx('inningsPitched', 'IP'), K_I = colIdx('strikeouts', 'SO', 'K'), BB_I = colIdx('baseOnBalls', 'BB');
    let outsSum = 0, kSum = 0, bbSum = 0, n = 0;
    for (const cat of categories) {
      for (const ev of (cat.events ?? [])) {
        const stats = ev.stats ?? [];
        const ip = parseInnings(parseS(stats, IP_I));
        if (ip == null) continue;
        outsSum += Math.round(ip * 3);
        kSum += parseS(stats, K_I) ?? 0;
        bbSum += parseS(stats, BB_I) ?? 0;
        n++;
      }
    }
    if (n === 0) return {};
    return { outsRecorded: outsSum / n, strikeouts: kSum / n, walks: bbSum / n };
  }

  const H_I = colIdx('hits', 'H'), HR_I = colIdx('homeRuns', 'HR'), RBI_I = colIdx('RBI', 'rbi'), R_I = colIdx('runs', 'R'), AB_I = colIdx('atBats', 'AB');
  let abSum = 0, hSum = 0, hrSum = 0, rbiSum = 0, rSum = 0, n = 0;
  for (const cat of categories) {
    for (const ev of (cat.events ?? [])) {
      const stats = ev.stats ?? [];
      const ab = parseS(stats, AB_I);
      if (ab == null) continue;
      abSum += ab;
      hSum += parseS(stats, H_I) ?? 0;
      hrSum += parseS(stats, HR_I) ?? 0;
      rbiSum += parseS(stats, RBI_I) ?? 0;
      rSum += parseS(stats, R_I) ?? 0;
      n++;
    }
  }
  if (n === 0) return {};
  return {
    atBats: abSum / n, hits: hSum / n, homeRuns: hrSum / n,
    rbi: rbiSum / n, runs: rSum / n, hra: (hSum + rSum + rbiSum) / n,
  };
}

// ─── Live pacing projection ───────────────────────────────────────────────────

function buildLiveProjection(player, stat, seasonAvg, contextMult) {
  const currentValue = player[stat] ?? 0;
  const unitsSoFar    = player.isPitcher ? player.outsRecorded : player.atBats;
  const seasonUnits    = player.isPitcher ? seasonAvg.outsRecorded : seasonAvg.atBats;
  const seasonStatRate = (seasonUnits && seasonAvg[stat] != null) ? seasonAvg[stat] / seasonUnits : null;
  const currentRate    = unitsSoFar > 0 ? currentValue / unitsSoFar : null;

  const elapsedFraction = seasonUnits ? Math.max(0.05, Math.min(1, unitsSoFar / seasonUnits)) : 0.5;
  const blendedRate = currentRate != null
    ? (currentRate * elapsedFraction) + ((seasonStatRate ?? currentRate) * (1 - elapsedFraction))
    : (seasonStatRate ?? 0);

  const remainingUnits = Math.max(0, (seasonUnits ?? unitsSoFar) - unitsSoFar);

  let blended = currentValue + blendedRate * remainingUnits;
  blended *= contextMult;
  blended = Math.max(blended, currentValue); // can't project below what's already happened

  return {
    currentValue,
    unitsSoFar, seasonUnits: seasonUnits ?? null,
    blended: Math.round(blended * 10) / 10,
    contextMult: Math.round(contextMult * 100) / 100,
  };
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

function formatPlayerForPrompt(p, projections) {
  const slotNote = p.battingOrderSlot ? ` | Batting ${p.battingOrderSlot}` : '';
  const lines = [`${p.teamAbbrev} | ${p.name}${slotNote}${p.isPitcher ? ' [PITCHER]' : ' [BATTER]'}`];
  for (const stat of Object.keys(projections)) {
    const proj = projections[stat];
    if (!proj) continue;
    const label = STAT_LABELS[stat] ?? stat;
    const multNote = proj.contextMult !== 1.0 ? ` | context mult: ${proj.contextMult}x (park/opponent/weather/sabermetrics)` : '';
    lines.push(`  ${label.toUpperCase()}: ${proj.currentValue} so far -> full-game projection ${proj.blended}${multNote}`);
  }
  return lines.join('\n');
}

async function generateLivePicks(game, playerLines, gameContext, existingLegs, legCount) {
  const gamePhase = `${gameContext.half} ${gameContext.inning}${gameContext.inning === 1 ? 'st' : gameContext.inning === 2 ? 'nd' : gameContext.inning === 3 ? 'rd' : 'th'}`;

  const existingLegsText = existingLegs.length > 0
    ? `\nEXISTING LEGS (exclude these players):\n${existingLegs.map((l, i) => `${i + 1}. ${l.player} - ${l.stat}`).join('\n')}\n`
    : '';

  const prompt = `You are an expert sports bettor specializing in live in-game MLB prop analysis.

GAME: ${game.awayTeam} @ ${game.homeTeam}
SCORE: ${game.awayTeam} ${gameContext.awayScore} - ${gameContext.homeScore} ${game.homeTeam}
GAME PHASE: ${gamePhase} (${gameContext.statusDescription})
${existingLegsText}
PLAYER DATA (live stats so far + full-game projections):
${playerLines}

PROJECTION METHODOLOGY:
- "full-game projection" blends current-game rate (per at-bat for batters, per out recorded for pitchers) with season rate, weighted by how much of a typical game's workload the player has already used, then projects the rest of the game
- Context multiplier already applied: park factor, opponent team ERA, sabermetrics (batter BA vs xBA regression, platoon splits, pitcher K%/xBA allowed), weather, and batting-order lineup weighting -- cite when meaningful (>1.08 or <0.92)

HOW TO USE:
- Recommend Over when the full-game projection clearly exceeds a realistic full-game threshold for that player/stat
- Early innings (1-3): high uncertainty, weight season rate more, be conservative
- Late innings (7+): current performance is more predictive, especially for a starter who's already worked deep
- A batter already at or above a typical full-game total with at-bats remaining is a strong Over
- H+R+RBI composite: strong pick when the player is a clear offensive contributor already

For each pick:
- player, team, stat (one of: ${BATTER_STATS.concat(PITCHER_STATS).map(s => `"${STAT_LABELS[s]}"`).join(', ')})
- direction ("Over" or "Under"), threshold (the number you're recommending), projection
- rationale: 1-2 sentences citing specific numbers
- rating: 1-5 stars based on how strong and well-supported the edge is
- rating_reason: one sentence
- risk_flags: array of concerns (empty if clean)

Return ONLY valid JSON, no markdown:
{
  "game_summary": "1-2 sentences on the game situation",
  "picks": [
    { "player": "Full Name", "team": "ABV", "stat": "Hits", "direction": "Over", "threshold": 1.5, "projection": 2.1, "rationale": "...", "rating": 4, "rating_reason": "...", "risk_flags": [] }
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
    console.error('[halftime/analyze-mlb] JSON parse error:', err.message);
    throw new Error(`Claude response JSON parse failed: ${err.message}`);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameId, homeTeam, awayTeam, gameDate, existingLegs, legCount = 4 } = req.body;
  if (!gameId) return res.status(400).json({ error: 'Missing required field: gameId' });

  try {
    const league = 'mlb';
    const summary = await fetchWithTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${gameId}`, 6000
    );
    if (!summary) return res.status(404).json({ error: 'Could not fetch live game data' });

    const { players, gameContext } = getLiveBoxScore(summary);
    if (players.length === 0) {
      return res.status(404).json({ error: 'No live player stats available yet for this game' });
    }

    const [homeERA, awayERA, weather] = await Promise.all([
      gameContext.homeTeamId ? getTeamPitchingStats(league, gameContext.homeTeamId).catch(() => null) : null,
      gameContext.awayTeamId ? getTeamPitchingStats(league, gameContext.awayTeamId).catch(() => null) : null,
      getGameWeather(gameContext.homeAbbrev, gameDate).catch(() => null),
    ]);

    const parkMult    = getParkFactor(gameContext.homeAbbrev);
    const weatherMult = getWeatherMultiplier(weather);

    // Opposing starter (for sabermetric platoon matchup) — the first pitcher
    // listed for each team, which is the starter unless they've been pulled.
    const homeStarter = players.find(p => p.isPitcher && String(p.teamId) === String(gameContext.homeTeamId));
    const awayStarter = players.find(p => p.isPitcher && String(p.teamId) === String(gameContext.awayTeamId));

    const [homeStarterSaber, awayStarterSaber] = await Promise.all([
      homeStarter ? getPitcherSabermetrics(homeStarter.name).catch(() => null) : null,
      awayStarter ? getPitcherSabermetrics(awayStarter.name).catch(() => null) : null,
    ]);

    const seasonAvgs = await Promise.all(players.map(p => getSeasonAverage(p.id, p.isPitcher).catch(() => ({}))));
    const batterSabers = await Promise.all(players.map(p =>
      !p.isPitcher ? getSabermetrics(p.name).catch(() => null) : Promise.resolve(null)
    ));

    const playerLines = [];
    const projByPlayer = {};

    players.forEach((p, i) => {
      const seasonAvg = seasonAvgs[i];
      const isHomePlayer = String(p.teamId) === String(gameContext.homeTeamId);
      const opponentERA  = isHomePlayer ? awayERA : homeERA;
      const opponentPitcherSaber = isHomePlayer ? awayStarterSaber : homeStarterSaber;
      const starterHand  = opponentPitcherSaber?.pitchHand ?? null;

      const projections = {};

      if (p.isPitcher) {
        for (const stat of PITCHER_STATS) {
          projections[stat] = buildLiveProjection(p, stat, seasonAvg, 1.0);
        }
      } else {
        const saberMult   = batterSabers[i] ? getSabermetricMultiplier(batterSabers[i], starterHand) : 1.0;
        const pitcherMult = opponentPitcherSaber ? getPitcherMultiplierForBatters(opponentPitcherSaber) : 1.0;
        const oppMult     = Math.max(0.80, Math.min(1.20, (opponentERA?.batterMultiplier ?? 1.0) * pitcherMult));
        const lineupMult  = getLineupMultiplier(p.battingOrderSlot);

        for (const stat of BATTER_STATS) {
          let contextMult = parkMult * weatherMult * saberMult * oppMult;
          if (stat === 'runs') contextMult *= lineupMult.runs;
          if (stat === 'rbi')  contextMult *= lineupMult.rbi;
          contextMult = Math.max(0.75, Math.min(1.35, contextMult));
          projections[stat] = buildLiveProjection(p, stat, seasonAvg, contextMult);
        }
      }

      // Drop stats with no meaningful edge (projection doesn't clear current value + a hair)
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
      ...p, hasRealLine: false, model: 'claude-haiku-4-5-20251001', sport: 'mlb',
    }));

    return res.status(200).json({
      success: true,
      gameId,
      game: { homeTeam: homeTeam || gameContext.homeAbbrev, awayTeam: awayTeam || gameContext.awayAbbrev, sport: 'baseball', league: 'mlb' },
      ...picks,
      picks: picksWithMeta,
      projections: projByPlayer,
      analyzed_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[halftime/analyze-mlb] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
