// api/pregame/analyze-nhl.js
// NHL pregame pick generator — robust model
//
// Factors:
//   - Per-game stats from season gamelog (goals, assists, points, shots, saves, etc.)
//   - Variance (std dev) over last 10 games → cushion required before recommending
//   - Floor detection → if line is below worst game in last 10, flag as near-free pick
//   - Trend detection → last 5 vs last 10 average, labeled up/down/neutral
//   - Back-to-back detection → ESPN schedule, flag + adjust projection down
//   - Opponent defensive rating → shots allowed/game for skaters, SA/game for goalies
//     compared to NHL average, applied as multiplier
//   - Data-driven star rating → computed from aligned factors, not model confidence string
//   - Position-aware → D-men get lower point projection weight vs forwards
//   - Goalie uncertainty flag → backup goalies labeled uncertain in prompt
//
// ESPN gamelog structure (confirmed):
//   data.names[] — column names at TOP LEVEL
//   category.events[].stats[] — parallel values array
//
// Skater cols: goals, assists, points, plusMinus, penaltyMinutes, shotsTotal,
//   shootingPct, powerPlayGoals, powerPlayAssists, shortHandedGoals,
//   shortHandedAssists, gameWinningGoals, timeOnIcePerGame, production
// Goalie cols: gameStarted, timeOnIcePerGame, wins, losses, ties,
//   overtimeLosses, goalsAgainst, avgGoalsAgainst, shotsAgainst,
//   saves, savePct, shutouts

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// NHL league averages (2024-25 season approximations)
// Used to normalise opponent defensive ratings into a multiplier
const NHL_AVG = {
  shotsAgainstPerGame: 29.5,  // avg shots a team faces per game
  goalsAgainstPerGame: 3.0,   // avg goals a team allows per game
  savesPerGame: 26.5,         // avg saves a goalie makes per start
};

// ─── ESPN helpers ────────────────────────────────────────────────────────────

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

async function findTeamId(abbreviation) {
  const data = await fetchJSON("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams");
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const match = teams.find(
    (t) => t.team.abbreviation?.toUpperCase() === abbreviation?.toUpperCase()
  );
  return match?.team?.id ?? null;
}

async function getTeamRoster(teamId) {
  const data = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${teamId}/roster`
  );
  const players = [];
  for (const group of data?.athletes ?? []) {
    for (const p of group?.items ?? []) {
      const posAbbr = p?.position?.abbreviation?.toUpperCase() ?? "";
      players.push({
        id: p.id,
        name: p.fullName,
        position: posAbbr,
        isGoalie: posAbbr === "G",
        isDefenseman: posAbbr === "D",
      });
    }
  }
  return players;
}

// Get opponent defensive stats: shots allowed/game and goals allowed/game
// Used to build a multiplier vs league average
// ESPN statistics endpoint returns season TOTALS — must divide by gamesPlayed
async function getTeamDefenseStats(teamId) {
  const statsData = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${teamId}/statistics`
  );
  if (!statsData) return null;

  const categories = statsData?.results?.stats?.categories ?? [];
  let shotsAgainstTotal = null;
  let goalsAgainstTotal = null;
  let savesTotal        = null;
  let gamesPlayed       = null;

  for (const cat of categories) {
    for (const stat of cat?.stats ?? []) {
      const name = stat.name?.toLowerCase();
      const val  = parseFloat(stat.value) || null;
      if (name === 'shotsagainst')  shotsAgainstTotal = val;
      if (name === 'goalsagainst')  goalsAgainstTotal = val;
      if (name === 'saves')         savesTotal        = val;
      if (name === 'gamesplayed' || name === 'games') gamesPlayed = val;
    }
  }

  // Fallback: NJ played ~70 games at this point in the season
  // If gamesPlayed not found, estimate from shots total (NHL teams average ~29.5 SA/game)
  if (!gamesPlayed && shotsAgainstTotal) {
    gamesPlayed = Math.round(shotsAgainstTotal / 29.5);
  }
  if (!gamesPlayed || gamesPlayed < 1) return null;

  return {
    shotsAgainstPG: shotsAgainstTotal ? Math.round((shotsAgainstTotal / gamesPlayed) * 10) / 10 : null,
    goalsAgainstPG: goalsAgainstTotal ? Math.round((goalsAgainstTotal / gamesPlayed) * 100) / 100 : null,
    savesPG:        savesTotal        ? Math.round((savesTotal        / gamesPlayed) * 10) / 10 : null,
    gamesPlayed,
  };
}

// Get team's last game date for back-to-back detection
async function getTeamSchedule(teamId) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  const data = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${teamId}/schedule?season=${yyyy}`
  );

  const events = data?.events ?? [];
  // Find most recent completed game before today
  const completed = events.filter(e => {
    const eDate = e.date?.substring(0, 10).replace(/-/g, '');
    return eDate < dateStr && e.competitions?.[0]?.status?.type?.completed;
  });

  if (!completed.length) return null;
  const lastGame = completed[completed.length - 1];
  const lastGameDate = new Date(lastGame.date);
  const diffMs = today - lastGameDate;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  return {
    lastGameDate: lastGame.date,
    daysSinceLastGame: Math.floor(diffDays),
    isBackToBack: diffDays < 1.5, // played yesterday
  };
}

// Parse "MM:SS" → decimal minutes
function parseTOI(toiStr) {
  if (!toiStr || toiStr === "--") return 0;
  const parts = String(toiStr).split(":");
  if (parts.length === 2) {
    return parseInt(parts[0], 10) + parseInt(parts[1], 10) / 60;
  }
  return parseFloat(toiStr) || 0;
}

async function getPlayerGamelog(playerId) {
  const data = await fetchJSON(
    `https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/${playerId}/gamelog`
  );
  if (!data) return null;

  const colNames = data.names ?? [];
  if (colNames.length === 0) return null;

  let category = null;
  for (const st of data?.seasonTypes ?? []) {
    for (const c of st?.categories ?? []) {
      if ((c?.events ?? []).length > 0) { category = c; break; }
    }
    if (category) break;
  }
  if (!category) return null;

  const events = category.events ?? [];
  if (events.length === 0) return null;

  function getStat(statsArr, name) {
    const idx = colNames.indexOf(name);
    if (idx === -1) return 0;
    return parseFloat(statsArr[idx]) || 0;
  }

  const gameStats = events.map((ev) => {
    const s = ev?.stats ?? [];
    return {
      goals:        getStat(s, "goals"),
      assists:      getStat(s, "assists"),
      points:       getStat(s, "points"),
      shots:        getStat(s, "shotsTotal"),
      toi:          parseTOI(s[colNames.indexOf("timeOnIcePerGame")]),
      saves:        getStat(s, "saves"),
      shotsAgainst: getStat(s, "shotsAgainst"),
      goalsAgainst: getStat(s, "goalsAgainst"),
      gameStarted:  getStat(s, "gameStarted"),
    };
  });

  return { gamesPlayed: events.length, gameStats };
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function avg(arr, key) {
  if (!arr.length) return 0;
  return arr.reduce((sum, g) => sum + (g[key] ?? 0), 0) / arr.length;
}

function stdDev(arr, key) {
  if (arr.length < 2) return null;
  const mean = avg(arr, key);
  const variance = arr.reduce((sum, g) => sum + Math.pow((g[key] ?? 0) - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function trend(recent5, last10, key) {
  if (!last10.length) return 'neutral';
  const r = avg(recent5, key);
  const s = avg(last10, key);
  if (s === 0) return 'neutral';
  const diff = (r - s) / s;
  if (diff > 0.15) return 'up';
  if (diff < -0.15) return 'down';
  return 'neutral';
}

// ─── Projection builders ─────────────────────────────────────────────────────

function buildSkaterProjection(player, gameStats, gamesPlayed, opponentDefense, isBackToBack) {
  if (gamesPlayed < 3) {
    return { skipped: true, reason: `Only ${gamesPlayed} games in log` };
  }

  const activeGames = gameStats.filter((g) => g.toi > 0);
  if (activeGames.length < 3) {
    return { skipped: true, reason: "Not enough active games" };
  }

  const recent5  = activeGames.slice(-5);
  const last10   = activeGames.slice(-10);
  const season   = activeGames;

  const recentTOI = avg(recent5, "toi");
  if (recentTOI < 8) {
    return { skipped: true, reason: `Low TOI (${recentTOI.toFixed(1)} min)` };
  }

  // 60/40 blend recent/season
  function blended(key) {
    return avg(recent5, key) * 0.6 + avg(season, key) * 0.4;
  }

  // Base projections
  let projShots   = blended("shots");
  let projPoints  = blended("points");
  let projGoals   = blended("goals");
  let projAssists = blended("assists");

  // Defensemen produce fewer points — reduce point projection weight for D
  if (player.isDefenseman) {
    projPoints  *= 0.85;
    projGoals   *= 0.75;
    projAssists *= 0.90;
  }

  // Opponent defensive multiplier for shots
  // If opponent allows more shots than average → multiplier > 1, fewer → < 1
  let oppShotMultiplier = 1.0;
  if (opponentDefense?.shotsAgainstPG && NHL_AVG.shotsAgainstPerGame > 0) {
    oppShotMultiplier = opponentDefense.shotsAgainstPG / NHL_AVG.shotsAgainstPerGame;
    oppShotMultiplier = Math.max(0.8, Math.min(1.2, oppShotMultiplier)); // cap at ±20%
    projShots *= oppShotMultiplier;
  }

  // Opponent defensive multiplier for scoring (goals against rate)
  let oppScoreMultiplier = 1.0;
  if (opponentDefense?.goalsAgainstPG && NHL_AVG.goalsAgainstPerGame > 0) {
    oppScoreMultiplier = opponentDefense.goalsAgainstPG / NHL_AVG.goalsAgainstPerGame;
    oppScoreMultiplier = Math.max(0.8, Math.min(1.2, oppScoreMultiplier));
    projPoints  *= oppScoreMultiplier;
    projGoals   *= oppScoreMultiplier;
    projAssists *= oppScoreMultiplier;
  }

  // Back-to-back penalty — fatigue reduces output ~8%
  if (isBackToBack) {
    projShots   *= 0.92;
    projPoints  *= 0.92;
    projGoals   *= 0.92;
    projAssists *= 0.92;
  }

  // Variance and floor
  const shotsStdDev  = stdDev(last10, "shots");
  const pointsStdDev = stdDev(last10, "points");
  const shotsFloor   = last10.length >= 3 ? Math.min(...last10.map(g => g.shots)) : null;
  const pointsFloor  = last10.length >= 3 ? Math.min(...last10.map(g => g.points)) : null;

  // Trends
  const shotsTrend  = trend(recent5, last10, "shots");
  const pointsTrend = trend(recent5, last10, "points");

  return {
    skipped: false,
    gamesPlayed,
    avgTOI:           recentTOI.toFixed(1),
    shots:            projShots,
    goals:            projGoals,
    assists:          projAssists,
    points:           projPoints,
    // Raw (pre-adjustment) for context
    rawShots:         blended("shots"),
    rawPoints:        blended("points"),
    // Variance
    shotsStdDev,
    pointsStdDev,
    // Floors
    shotsFloor,
    pointsFloor,
    // Trends
    shotsTrend,
    pointsTrend,
    // Context flags
    isBackToBack:       !!isBackToBack,
    oppShotMultiplier:  Math.round(oppShotMultiplier * 100) / 100,
    oppScoreMultiplier: Math.round(oppScoreMultiplier * 100) / 100,
    isDefenseman:       !!player.isDefenseman,
    recentGames:  recent5.length,
    seasonGames:  season.length,
  };
}

function buildGoalieProjection(player, gameStats, gamesPlayed, opponentOffense, isBackToBack) {
  if (gamesPlayed < 2) {
    return { skipped: true, reason: `Only ${gamesPlayed} games in log` };
  }

  const starts = gameStats.filter((g) => g.gameStarted >= 1 || g.shotsAgainst > 0);
  if (starts.length < 2) {
    return { skipped: true, reason: "Not enough starts" };
  }

  const recent5 = starts.slice(-5);
  const last10  = starts.slice(-10);
  const season  = starts;

  function blended(key) {
    return avg(recent5, key) * 0.55 + avg(season, key) * 0.45;
  }

  let projSaves        = blended("saves");
  let projShotsAgainst = blended("shotsAgainst");
  let projGA           = blended("goalsAgainst");

  // Opponent offensive pressure: if they shoot more than average, goalie faces more
  // opponentOffense here = the AWAY/HOME team's offensive stats
  // We use the opponent's shots-against (which is shots-FOR for the goalie's opponent)
  // Approximate: if opponent allows fewer shots, they likely generate more
  // Better proxy: use opponent's goals-for rate vs league avg
  // For now use shotsAgainstPG as proxy for opponent shot generation
  let oppPressureMultiplier = 1.0;
  if (opponentOffense?.shotsAgainstPG && NHL_AVG.shotsAgainstPerGame > 0) {
    // If opponent allows many shots against (weak defense), they likely generate lots of shots too
    // This is an imperfect proxy — ideally we'd have shots-for data
    oppPressureMultiplier = opponentOffense.shotsAgainstPG / NHL_AVG.shotsAgainstPerGame;
    oppPressureMultiplier = Math.max(0.85, Math.min(1.15, oppPressureMultiplier));
    projShotsAgainst *= oppPressureMultiplier;
    projSaves        *= oppPressureMultiplier;
  }

  if (isBackToBack) {
    projSaves        *= 0.93;
    projShotsAgainst *= 0.93;
  }

  const savesStdDev = stdDev(last10, "saves");
  const savesFloor  = last10.length >= 3 ? Math.min(...last10.map(g => g.saves)) : null;
  const savesTrend  = trend(recent5, last10, "saves");
  const savePct     = projSaves / (projSaves + projGA + 0.001);

  // Flag if this looks like a backup (< 10 starts in the log)
  const isLikelyBackup = starts.length < 10;

  return {
    skipped: false,
    gamesPlayed,
    starts:              starts.length,
    saves:               projSaves,
    shotsAgainst:        projShotsAgainst,
    goalsAgainst:        projGA,
    savePct,
    savesStdDev,
    savesFloor,
    savesTrend,
    isBackToBack:        !!isBackToBack,
    isLikelyBackup,
    oppPressureMultiplier: Math.round(oppPressureMultiplier * 100) / 100,
    recentGames: recent5.length,
    seasonGames: season.length,
  };
}

// ─── Data-driven star rating ──────────────────────────────────────────────────
// Replaces the model's confidence string with a computed score based on
// how many factors align in the pick's favor.

function computeRating(pick, proj) {
  let score = 0;
  const stat = pick.stat;
  const line = pick.line;
  const projection = pick.rawProjection;

  if (projection == null || line == null) return 3;

  const edge = projection - line; // positive = projection clears line

  // 1. How much does projection clear the line?
  const edgePct = line > 0 ? edge / line : 0;
  if (edgePct > 0.30) score += 2;
  else if (edgePct > 0.15) score += 1;

  // 2. Trend aligned with pick direction
  const trendKey = stat === 'shots' ? 'shotsTrend' : stat === 'saves' ? 'savesTrend' : 'pointsTrend';
  if (proj[trendKey] === 'up') score += 1;
  else if (proj[trendKey] === 'down') score -= 1;

  // 3. Low variance = more predictable
  const stdDevKey = stat === 'shots' ? 'shotsStdDev' : stat === 'saves' ? 'savesStdDev' : 'pointsStdDev';
  const sd = proj[stdDevKey];
  if (sd != null && sd < edge) score += 1; // std dev smaller than our edge = good cushion

  // 4. Floor below line = near-free pick
  const floorKey = stat === 'shots' ? 'shotsFloor' : stat === 'saves' ? 'savesFloor' : 'pointsFloor';
  const floor = proj[floorKey];
  if (floor != null && floor >= line) score += 2; // never gone below line in last 10

  // 5. Back-to-back penalty
  if (proj.isBackToBack) score -= 1;

  // 6. Opponent adjustment boosted projection
  const oppMult = stat === 'saves' ? proj.oppPressureMultiplier : stat === 'shots' ? proj.oppShotMultiplier : proj.oppScoreMultiplier;
  if (oppMult != null && oppMult > 1.05) score += 1;
  else if (oppMult != null && oppMult < 0.95) score -= 1;

  // 7. Backup goalie uncertainty
  if (proj.isLikelyBackup) score -= 1;

  // Clamp to 1-5
  return Math.max(1, Math.min(5, score + 3)); // baseline 3, adjust from there
}

// ─── Pick generator ───────────────────────────────────────────────────────────

async function generateNHLPicks(homeTeam, awayTeam, homeProjections, awayProjections, legCount) {

  function skaterLine(p, proj) {
    if (proj.skipped) return null;
    const b2b    = proj.isBackToBack ? ' ⚠️B2B' : '';
    const oppAdj = proj.oppShotMultiplier !== 1.0
      ? ` opp×${proj.oppShotMultiplier}` : '';
    const trendStr = proj.shotsTrend !== 'neutral'
      ? ` shots-${proj.shotsTrend}` : '';
    return (
      `${p.name} (${p.position}${b2b}, ${proj.gamesPlayed}GP, TOI ${proj.avgTOI}min${oppAdj}${trendStr})\n` +
      `  Shots: ${proj.shots.toFixed(2)} (floor ${proj.shotsFloor ?? '?'}, σ${proj.shotsStdDev?.toFixed(1) ?? '?'}) | ` +
      `PTS: ${proj.points.toFixed(2)} (floor ${proj.pointsFloor ?? '?'}) | ` +
      `G: ${proj.goals.toFixed(2)} | A: ${proj.assists.toFixed(2)}`
    );
  }

  function goalieLine(p, proj) {
    if (proj.skipped) return null;
    const b2b     = proj.isBackToBack ? ' ⚠️B2B' : '';
    const backup  = proj.isLikelyBackup ? ' ⚠️LIKELY-BACKUP' : '';
    const trendStr = proj.savesTrend !== 'neutral' ? ` saves-${proj.savesTrend}` : '';
    return (
      `${p.name} (G${b2b}${backup}, ${proj.starts} starts${trendStr})\n` +
      `  Saves: ${proj.saves.toFixed(1)} (floor ${proj.savesFloor ?? '?'}, σ${proj.savesStdDev?.toFixed(1) ?? '?'}) | ` +
      `SA: ${proj.shotsAgainst.toFixed(1)} | GA: ${proj.goalsAgainst.toFixed(2)} | ` +
      `SV%: ${(proj.savePct * 100).toFixed(1)}%`
    );
  }

  function section(projections, goalies) {
    return projections
      .filter((x) => x.player.isGoalie === goalies && !x.proj.skipped)
      .map((x) => goalies ? goalieLine(x.player, x.proj) : skaterLine(x.player, x.proj))
      .filter(Boolean)
      .join("\n") || "(none qualified)";
  }

  const prompt = `You are an NHL prop bet analyst. Generate player prop picks for tonight's game.

GAME: ${awayTeam} @ ${homeTeam}

DATA KEY: ⚠️B2B = back-to-back game (fatigue risk), ⚠️LIKELY-BACKUP = goalie may not start,
opp×N = opponent defensive multiplier applied (>1 = weak defense, <1 = strong),
σ = std dev over last 10 games, floor = worst output in last 10 games,
shots-up/down = trending direction last 5 vs last 10 games

${awayTeam} SKATERS:
${section(awayProjections, false)}

${awayTeam} GOALIES:
${section(awayProjections, true)}

${homeTeam} SKATERS:
${section(homeProjections, false)}

${homeTeam} GOALIES:
${section(homeProjections, true)}

AVAILABLE PROPS AND TYPICAL LINES:
- shots (total shot attempts): line usually 2.5–4.5
- points: line usually 0.5
- goals: line usually 0.5
- assists: line usually 0.5
- saves (goalies only): line usually 20.5–27.5

INSTRUCTIONS:
- Pick exactly ${legCount} highest-confidence props
- Projection already accounts for opponent defense and back-to-back fatigue
- Only recommend OVER when projection clearly clears the typical line
- Floor >= line means player has never gone under in last 10 games — prioritize these
- Low σ relative to the edge = more predictable — prefer these
- Avoid ⚠️B2B picks unless projection edge is very large
- Avoid ⚠️LIKELY-BACKUP goalies entirely
- Defensemen (D) have fewer scoring opportunities — weight shots over points for them
- 1-sentence rationale citing the most relevant factor (trend, floor, opponent, TOI)
- Return ONLY a JSON array, no markdown, no preamble:

[
  {
    "player": "Player Name",
    "team": "ABBR",
    "position": "C",
    "stat": "shots",
    "line": 2.5,
    "pick": "OVER",
    "projection": 3.4,
    "confidence": "high",
    "rationale": "One sentence."
  }
]

Stat name options: shots, points, goals, assists, saves`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content[0].text.trim();
  let rawPicks = [];
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) rawPicks = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("[analyze-nhl] JSON parse error:", e.message);
    console.error("[analyze-nhl] Raw:", raw.substring(0, 500));
  }

  // Build a lookup of projections by player name for rating computation
  const projByPlayer = {};
  for (const { player, proj } of [...homeProjections, ...awayProjections]) {
    if (!proj.skipped) projByPlayer[player.name] = proj;
  }

  // Normalize + hard filter + data-driven rating
  const picks = rawPicks
    .filter((p) => {
      if (p.pick === 'OVER')  return p.projection != null && p.projection > p.line;
      if (p.pick === 'UNDER') return p.projection != null && p.projection < p.line;
      return false;
    })
    .map((p) => {
      const proj = projByPlayer[p.player] ?? {};
      const rating = computeRating({ ...p, rawProjection: p.projection }, proj);

      // Build risk flags
      const risk_flags = [];
      if (proj.isBackToBack) risk_flags.push("back-to-back");
      if (proj.isLikelyBackup) risk_flags.push("likely backup goalie");
      if (proj.oppShotMultiplier < 0.95 || proj.oppScoreMultiplier < 0.95) risk_flags.push("strong opponent defense");
      if (proj.shotsTrend === 'down' && p.stat === 'shots') risk_flags.push("trending down");
      if (proj.pointsTrend === 'down' && (p.stat === 'points' || p.stat === 'assists' || p.stat === 'goals')) risk_flags.push("trending down");

      // Build rating reason
      const reasons = [];
      const floorKey = p.stat === 'shots' ? 'shotsFloor' : p.stat === 'saves' ? 'savesFloor' : 'pointsFloor';
      if (proj[floorKey] != null && proj[floorKey] >= p.line) reasons.push(`floor ${proj[floorKey]} ≥ line`);
      if (proj.oppShotMultiplier > 1.05 && p.stat === 'shots') reasons.push(`weak opp defense (×${proj.oppShotMultiplier})`);
      if (proj.oppScoreMultiplier > 1.05 && ['points','goals','assists'].includes(p.stat)) reasons.push(`weak opp defense (×${proj.oppScoreMultiplier})`);
      const trendKey = p.stat === 'shots' ? 'shotsTrend' : p.stat === 'saves' ? 'savesTrend' : 'pointsTrend';
      if (proj[trendKey] === 'up') reasons.push('trending up');

      return {
        player:        p.player,
        team:          p.team,
        position:      p.position,
        stat:          p.stat,
        direction:     p.pick === 'OVER' ? 'Over' : 'Under',
        threshold:     p.line,
        hasRealLine:   false,
        projection:    p.projection != null ? Math.round(p.projection * 100) / 100 : null,
        rating,
        rating_reason: reasons.length ? reasons.join(' · ') : `proj ${p.projection} vs line ${p.line}`,
        rationale:     p.rationale,
        risk_flags,
        sport:         'nhl',
        isBackToBack:  !!proj.isBackToBack,
        trend:         proj[trendKey] ?? 'neutral',
      };
    });

  return picks;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { homeTeam, awayTeam, homeTeamId, awayTeamId, legCount = 4 } = req.body;

  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ error: "homeTeam and awayTeam required" });
  }

  try {
    const homeId = homeTeamId || await findTeamId(homeTeam);
    const awayId = awayTeamId || await findTeamId(awayTeam);

    if (!homeId || !awayId) {
      return res.status(404).json({
        error: `Could not find team IDs for ${homeTeam} / ${awayTeam}`,
      });
    }

    // Fetch rosters, defense stats, and schedule in parallel
    const [homeRoster, awayRoster, homeDefense, awayDefense, homeSchedule, awaySchedule] =
      await Promise.all([
        getTeamRoster(homeId),
        getTeamRoster(awayId),
        getTeamDefenseStats(homeId),
        getTeamDefenseStats(awayId),
        getTeamSchedule(homeId),
        getTeamSchedule(awayId),
      ]);

    const homeB2B = homeSchedule?.isBackToBack ?? false;
    const awayB2B = awaySchedule?.isBackToBack ?? false;

    function trimRoster(roster) {
      const goalies = roster.filter((p) => p.isGoalie).slice(0, 2);
      const skaters = roster.filter((p) => !p.isGoalie).slice(0, 18);
      return [...skaters, ...goalies];
    }

    const homePlayers = trimRoster(homeRoster);
    const awayPlayers = trimRoster(awayRoster);

    // Home team faces away team's defense (and vice versa)
    async function fetchProjections(players, opponentDefense, isTeamB2B) {
      return Promise.all(
        players.map(async (p) => {
          const log = await getPlayerGamelog(p.id);
          if (!log) return { player: p, proj: { skipped: true, reason: "No gamelog data" } };
          const proj = p.isGoalie
            ? buildGoalieProjection(p, log.gameStats, log.gamesPlayed, opponentDefense, isTeamB2B)
            : buildSkaterProjection(p, log.gameStats, log.gamesPlayed, opponentDefense, isTeamB2B);
          return { player: p, proj };
        })
      );
    }

    // Home skaters face away defense; away skaters face home defense
    const [homeProjections, awayProjections] = await Promise.all([
      fetchProjections(homePlayers, awayDefense, homeB2B),
      fetchProjections(awayPlayers, homeDefense, awayB2B),
    ]);

    const picks = await generateNHLPicks(homeTeam, awayTeam, homeProjections, awayProjections, legCount);

    const projectionsMap = {};
    for (const { player, proj } of [...homeProjections, ...awayProjections]) {
      if (!proj.skipped) {
        projectionsMap[player.name] = { ...proj, position: player.position, isGoalie: player.isGoalie };
      }
    }

    const allProj = [...homeProjections, ...awayProjections];
    return res.status(200).json({
      success: true,
      picks,
      projections: projectionsMap,
      meta: {
        homeTeam,
        awayTeam,
        homeRosterSize:  homePlayers.length,
        awayRosterSize:  awayPlayers.length,
        qualifiedSkaters: allProj.filter((x) => !x.player.isGoalie && !x.proj.skipped).length,
        qualifiedGoalies: allProj.filter((x) => x.player.isGoalie  && !x.proj.skipped).length,
        homeB2B,
        awayB2B,
        homeDefense,
        awayDefense,
      },
    });
  } catch (err) {
    console.error("[analyze-nhl] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
