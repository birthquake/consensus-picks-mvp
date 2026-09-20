// FILE LOCATION: api/pregame/analyze-nfl.js
// NFL pregame prop pick generator — passing / rushing / receiving yards
//
// Factors:
//   - Per-game stats from season gamelog (passing/rushing/receiving yards)
//   - Blend: last 3 games (55%) + season avg (45%) — NFL's 17-game season makes
//     a 5-game window too large a share to use as "recent form" the way NHL/MLB do
//   - Variance (std dev over season) + floor detection (worst of last 5 games)
//   - Trend detection → last 3 vs season, up/down/neutral
//   - Bye-week / rest detection → mild positive bump for players coming off 10+ days rest
//   - Recency filter → skip players whose last gamelog game is 21+ days old (injured/inactive,
//     tolerant of a single bye week which is ~14 days)
//   - Data-driven star rating, same approach as analyze-mlb.js / analyze-nhl.js
//
// NOT included in this version:
//   - Opponent defensive adjustment — ESPN's team statistics endpoint for NFL only exposes
//     a team's own offensive output plus turnover-style defensive stats (tackles/sacks/INTs),
//     not yards allowed. True opponent defense would require aggregating box scores across
//     each team's full schedule — out of scope for now.
//   - Real sportsbook lines — computed thresholds only, same as analyze-nhl.js.
//
// ESPN gamelog structure (confirmed against live API):
//   data.names[] — column names at TOP LEVEL
//   data.events[eventId].gameDate — used for the recency/inactive filter
//   category.events[].stats[] — parallel values array
//
// QB cols: completions, passingAttempts, passingYards, completionPct, yardsPerPassAttempt,
//   passingTouchdowns, interceptions, longPassing, sacks, QBRating, adjQBR,
//   rushingAttempts, rushingYards, yardsPerRushAttempt, rushingTouchdowns, longRushing
// RB cols: rushingAttempts, rushingYards, yardsPerRushAttempt, rushingTouchdowns, longRushing,
//   receptions, receivingTargets, receivingYards, yardsPerReception, receivingTouchdowns, ...
// WR/TE cols: receptions, receivingTargets, receivingYards, yardsPerReception,
//   receivingTouchdowns, longReception, rushingAttempts, rushingYards, ...

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// ─── Stat config ──────────────────────────────────────────────────────────────

const QB_STATS     = ['passingYards'];
const RB_STATS     = ['rushingYards', 'receivingYards'];
const RECEIVER_STATS = ['receivingYards'];

const STAT_LABELS = {
  passingYards:   'Passing Yards',
  rushingYards:   'Rushing Yards',
  receivingYards: 'Receiving Yards',
};

const SPORTSBOOK_MINIMUMS = {
  passingYards:   149.5,
  rushingYards:    29.5,
  receivingYards:  19.5,
};

const EDGE_THRESHOLDS = {
  passingYards:   { high: 40, mid: 20 },
  rushingYards:   { high: 15, mid: 8 },
  receivingYards: { high: 15, mid: 8 },
};

const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

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

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function findTeamId(abbreviation) {
  const data = await fetchJSON("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=50");
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const match = teams.find(
    (t) => t.team.abbreviation?.toUpperCase() === abbreviation?.toUpperCase()
  );
  return match?.team?.id ?? null;
}

async function getTeamRoster(teamId) {
  const data = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`
  );
  const players = [];
  for (const group of data?.athletes ?? []) {
    for (const p of group?.items ?? []) {
      const posAbbr = p?.position?.abbreviation?.toUpperCase() ?? "";
      if (!SKILL_POSITIONS.has(posAbbr)) continue;
      players.push({
        id: p.id,
        name: p.fullName,
        position: posAbbr,
        isQB: posAbbr === "QB",
        isRB: posAbbr === "RB",
        isReceiver: posAbbr === "WR" || posAbbr === "TE",
      });
    }
  }
  return players;
}

// Bye-week / rest detection — NFL plays weekly, so "back-to-back" doesn't apply.
// A gap of 10+ days before the target game means the team is coming off a bye —
// treated as a mild positive signal (fresher legs), not a risk flag.
async function getTeamLastGameInfo(teamId, gameDate) {
  const target = gameDate ? new Date(gameDate) : new Date();
  const yyyy = target.getFullYear();

  const data = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/schedule?season=${yyyy}`
  );

  const events = data?.events ?? [];
  const targetStr = formatDate(target);
  const completed = events.filter(e => {
    const eDate = e.date?.substring(0, 10).replace(/-/g, '');
    return eDate < targetStr && e.competitions?.[0]?.status?.type?.completed;
  });

  if (!completed.length) return null;
  const lastGame = completed[completed.length - 1];
  const lastGameDate = new Date(lastGame.date);
  const diffDays = (target - lastGameDate) / (1000 * 60 * 60 * 24);

  return {
    lastGameDate: lastGame.date,
    daysSinceLastGame: Math.floor(diffDays),
    cameOffBye: diffDays >= 10,
  };
}

async function getPlayerGamelog(playerId) {
  const data = await fetchJSON(
    `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${playerId}/gamelog`
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

  const lastEventId = events[events.length - 1]?.eventId;
  const lastEventDate = lastEventId && data.events?.[lastEventId]?.gameDate
    ? new Date(data.events[lastEventId].gameDate)
    : null;

  const gameStats = events.map((ev) => {
    const s = ev?.stats ?? [];
    return {
      passingYards:     getStat(s, "passingYards"),
      rushingYards:     getStat(s, "rushingYards"),
      receivingYards:   getStat(s, "receivingYards"),
      receivingTargets: getStat(s, "receivingTargets"),
    };
  });

  return { gamesPlayed: events.length, gameStats, lastEventDate };
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function avg(arr, key) {
  if (!arr.length) return null;
  const vals = arr.map(g => g[key]).filter(v => v != null && !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

function stdDev(arr, key) {
  if (arr.length < 2) return null;
  const mean = avg(arr, key);
  if (mean == null) return null;
  const variance = arr.reduce((sum, g) => sum + Math.pow((g[key] ?? 0) - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function trend(recent, season, key) {
  const r = avg(recent, key);
  const s = avg(season, key);
  if (r == null || s == null || s === 0) return 'neutral';
  const diff = (r - s) / s;
  if (diff > 0.15) return 'up';
  if (diff < -0.15) return 'down';
  return 'neutral';
}

// ─── Projection builder ───────────────────────────────────────────────────────

function buildPlayerProjection(player, gameStats, gamesPlayed, restInfo, statsToProject) {
  // NFL's 17-game season means the first couple weeks only have 1 logged game per
  // player — don't hard-block on sample size, the computeRating small-sample
  // penalty already lowers confidence instead.
  if (gamesPlayed < 1) {
    return { skipped: true, reason: `Only ${gamesPlayed} games in log`, gamesPlayed, projections: {} };
  }

  const recent3 = gameStats.slice(-3);
  const last5   = gameStats.slice(-5);
  const season  = gameStats;

  const projections = {};

  for (const stat of statsToProject) {
    const seasonAvgVal = avg(season, stat);
    if (seasonAvgVal == null || seasonAvgVal === 0) continue;

    // RBs with negligible receiving usage shouldn't get a receiving-yards prop
    if (stat === 'receivingYards' && player.isRB) {
      const tgtsPerGame = avg(season, 'receivingTargets');
      if (!tgtsPerGame || tgtsPerGame < 0.5) continue;
    }

    const recentAvg = avg(recent3, stat);
    let blended = recentAvg != null ? (recentAvg * 0.55 + seasonAvgVal * 0.45) : seasonAvgVal;
    if (restInfo?.cameOffBye) blended *= 1.03;

    const sd    = stdDev(season, stat);
    const floor = last5.length ? Math.min(...last5.map(g => g[stat] ?? 0)) : null;
    const trendDir = trend(recent3, season, stat);

    const min = SPORTSBOOK_MINIMUMS[stat] ?? 10;
    const cushion = sd != null ? Math.max(sd * 0.5, min * 0.1) : min * 0.15;
    const threshold = Math.max(Math.round((blended - cushion) * 2) / 2, min);
    const edge = Math.round((blended - threshold) * 10) / 10;

    projections[stat] = {
      blended: Math.round(blended * 10) / 10,
      seasonAvg: Math.round(seasonAvgVal * 10) / 10,
      recentAvg: recentAvg != null ? Math.round(recentAvg * 10) / 10 : null,
      threshold, edge,
      stdDev: sd != null ? Math.round(sd * 10) / 10 : null,
      floor,
      trend: trendDir,
      sampleSize: season.length,
      cameOffBye: !!restInfo?.cameOffBye,
    };
  }

  return { skipped: Object.keys(projections).length === 0, gamesPlayed, projections };
}

// ─── Data-driven star rating ──────────────────────────────────────────────────

function computeRating(proj, stat) {
  if (!proj) return 3;
  let score = 0;
  const edgeCfg = EDGE_THRESHOLDS[stat] ?? { high: 20, mid: 10 };
  const edge = proj.edge ?? 0;

  if (edge > edgeCfg.high) score += 2;
  else if (edge > edgeCfg.mid) score += 1;

  if (proj.trend === 'up') score += 1;
  else if (proj.trend === 'down') score -= 1;

  if (proj.stdDev != null && proj.stdDev < edge) score += 1;
  if (proj.floor != null && proj.floor >= proj.threshold) score += 1;
  if (proj.cameOffBye) score += 1;
  if (proj.sampleSize != null && proj.sampleSize < 3) score -= 1;

  return Math.max(1, Math.min(5, score + 3));
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

function formatPlayerForPrompt(p) {
  const bye = p.cameOffBye ? ' ✅OFF-BYE' : '';
  const lines = [`${p.teamAbbrev} | ${p.name} (${p.position}${bye}, ${p.gamesPlayed}GP)`];

  for (const stat of Object.keys(p.projections)) {
    const s = p.projections[stat];
    const label = STAT_LABELS[stat] ?? stat;
    const trendIcon = s.trend === 'up' ? 'TRENDING UP' : s.trend === 'down' ? 'TRENDING DOWN' : 'NEUTRAL';
    lines.push(
      `  ${label.toUpperCase()}:
    Projection: ${s.blended} (L3=${s.recentAvg ?? '?'} Season=${s.seasonAvg ?? '?'})
    Suggested threshold: Over ${s.threshold} | Edge: ${s.edge}
    Variance (std dev): ${s.stdDev ?? '?'} | Floor (last 5): ${s.floor ?? '?'}
    Trend: ${trendIcon} | Sample: ${s.sampleSize} games`
    );
  }

  return lines.join('\n');
}

async function generateNFLPicks(homeTeam, awayTeam, playerData, existingLegs, legCount) {
  const qbs       = playerData.filter(p => p.isQB);
  const rbs       = playerData.filter(p => p.isRB);
  const receivers = playerData.filter(p => p.isReceiver);

  const section = (players) => players.map(formatPlayerForPrompt).join('\n\n') || '(none qualified)';

  const existingLegsText = existingLegs.length > 0
    ? `\nEXISTING LEGS (exclude these players):\n${existingLegs.map((l, i) => `${i + 1}. ${l.player} - ${l.stat}`).join('\n')}\n`
    : '';

  const prompt = `You are an expert NFL prop bet analyst. Generate player prop picks for this week's game.

GAME: ${awayTeam} @ ${homeTeam}
${existingLegsText}
DATA KEY: ✅OFF-BYE = team coming off a bye week (extra rest, mild positive signal),
σ = std dev over the season, floor = worst output in last 5 games,
L3 = last 3 games average

QUARTERBACKS:
${section(qbs)}

RUNNING BACKS:
${section(rbs)}

RECEIVERS (WR/TE):
${section(receivers)}

HOW TO USE THESE PROJECTIONS:
- Suggested threshold = blended projection minus a variance cushion, already computed
- HARD RULE: Only recommend picks where projection clearly exceeds the threshold
- Floor >= threshold is a strong signal — player has not gone below the line in last 5 games
- Low σ relative to the edge = more predictable — prefer these
- ✅OFF-BYE players get a small positive bump already baked into the projection
- Small sample size (<3 games) should lower confidence — mention in risk_flags

For each pick provide:
- player, team, position, stat (one of: "Passing Yards", "Rushing Yards", "Receiving Yards")
- direction (always "Over"), threshold, projection, edge
- rationale: 1-2 sentences citing SPECIFIC numbers
- rating: the pre-computed star rating (integer 1-5) — use exactly as given
- rating_reason: one sentence on key factors
- risk_flags: array of concerns (empty if clean)

Return ONLY a JSON array, no markdown, no preamble:
[
  {
    "player": "Player Name",
    "team": "ABBR",
    "position": "QB",
    "stat": "Passing Yards",
    "direction": "Over",
    "threshold": 249.5,
    "projection": 278.4,
    "edge": 28.9,
    "rationale": "...",
    "rating": 4,
    "rating_reason": "...",
    "risk_flags": []
  }
]

Recommend exactly ${legCount} picks if ${legCount} strong options exist. Never pad with weak picks.`;

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
    console.error("[analyze-nfl] JSON parse error:", e.message);
    console.error("[analyze-nfl] Raw:", raw.substring(0, 500));
  }

  const statKeyByLabel = { 'Passing Yards': 'passingYards', 'Rushing Yards': 'rushingYards', 'Receiving Yards': 'receivingYards' };
  const projByPlayer = {};
  for (const p of playerData) projByPlayer[p.name] = p.projections;

  const picks = rawPicks
    .filter((p) => p.projection != null && p.threshold != null && p.projection > p.threshold)
    .map((p) => {
      const statKey = statKeyByLabel[p.stat] ?? null;
      const proj = statKey ? (projByPlayer[p.player]?.[statKey] ?? {}) : {};

      const risk_flags = Array.isArray(p.risk_flags) ? [...p.risk_flags] : [];
      if (proj.sampleSize != null && proj.sampleSize < 3) risk_flags.push('small sample size');
      if (proj.trend === 'down') risk_flags.push('trending down');

      return {
        player:        p.player,
        team:          p.team,
        position:      p.position,
        stat:          p.stat,
        direction:     'Over',
        threshold:     p.threshold,
        hasRealLine:   false,
        projection:    p.projection != null ? Math.round(p.projection * 10) / 10 : null,
        edge:          proj.edge ?? (p.projection != null && p.threshold != null ? Math.round((p.projection - p.threshold) * 10) / 10 : null),
        rating:        proj.threshold != null ? computeRating(proj, statKey) : (p.rating ?? 3),
        rating_reason: p.rating_reason,
        rationale:     p.rationale,
        risk_flags,
        sport:         'nfl',
        cameOffBye:    !!proj.cameOffBye,
        trend:         proj.trend ?? 'neutral',
      };
    });

  return picks;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { homeTeam, awayTeam, homeTeamId, awayTeamId, gameDate, existingLegs, legCount = 4 } = req.body;

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

    const [homeRoster, awayRoster, homeRestInfo, awayRestInfo] = await Promise.all([
      getTeamRoster(homeId),
      getTeamRoster(awayId),
      getTeamLastGameInfo(homeId, gameDate).catch(() => null),
      getTeamLastGameInfo(awayId, gameDate).catch(() => null),
    ]);

    function trimRoster(roster) {
      const qbs       = roster.filter(p => p.isQB).slice(0, 2);
      const rbs       = roster.filter(p => p.isRB).slice(0, 3);
      const receivers = roster.filter(p => p.isReceiver).slice(0, 7);
      return [...qbs, ...rbs, ...receivers];
    }

    const homePlayers = trimRoster(homeRoster);
    const awayPlayers = trimRoster(awayRoster);

    const targetDate = gameDate ? new Date(gameDate) : new Date();

    async function fetchProjections(players, teamAbbrev, restInfo) {
      const results = await Promise.all(
        players.map(async (p) => {
          const log = await getPlayerGamelog(p.id);
          if (!log) return null;

          // Recency filter — skip players inactive/injured for 21+ days (tolerates one bye)
          if (log.lastEventDate) {
            const daysSince = (targetDate - log.lastEventDate) / (1000 * 60 * 60 * 24);
            if (daysSince > 21) return null;
          }

          const statsToProject = p.isQB ? QB_STATS : p.isRB ? RB_STATS : RECEIVER_STATS;
          const built = buildPlayerProjection(p, log.gameStats, log.gamesPlayed, restInfo, statsToProject);
          if (built.skipped) return null;

          // Drop any stat that doesn't clear its own threshold (e.g. a single-game
          // sample dragged blended below the sportsbook minimum, or even negative) —
          // same hard filter analyze-mlb.js applies before formatting the Claude prompt.
          for (const stat of Object.keys(built.projections)) {
            const proj = built.projections[stat];
            if (proj.blended <= proj.threshold) delete built.projections[stat];
          }
          if (Object.keys(built.projections).length === 0) return null;

          return { ...p, teamAbbrev, gamesPlayed: built.gamesPlayed, projections: built.projections, cameOffBye: !!restInfo?.cameOffBye };
        })
      );
      return results.filter(Boolean);
    }

    const [homeProjected, awayProjected] = await Promise.all([
      fetchProjections(homePlayers, homeTeam, homeRestInfo),
      fetchProjections(awayPlayers, awayTeam, awayRestInfo),
    ]);

    const playerData = [...homeProjected, ...awayProjected];

    console.log(`[analyze-nfl] ${awayTeam} @ ${homeTeam}: ${playerData.length}/${homePlayers.length + awayPlayers.length} players with usable projections`);

    if (playerData.length === 0) {
      return res.status(404).json({ error: 'Could not build projections for any players in this game' });
    }

    const picks = await generateNFLPicks(homeTeam, awayTeam, playerData, existingLegs || [], legCount);

    const projectionsMap = {};
    for (const p of playerData) {
      projectionsMap[p.name] = { position: p.position, ...p.projections };
    }

    return res.status(200).json({
      success: true,
      picks,
      projections: projectionsMap,
      meta: {
        homeTeam,
        awayTeam,
        homeRosterSize: homePlayers.length,
        awayRosterSize: awayPlayers.length,
        qualifiedPlayers: playerData.length,
        homeCameOffBye: !!homeRestInfo?.cameOffBye,
        awayCameOffBye: !!awayRestInfo?.cameOffBye,
      },
    });
  } catch (err) {
    console.error("[analyze-nfl] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
