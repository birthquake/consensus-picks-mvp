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
//   - Opponent defense adjustment → yards allowed per game, aggregated from the opponent's
//     own box scores this season (see lib/nfl-team-defense.js), applied as a ±15% multiplier
//   - Recency filter → skip players whose last gamelog game is 21+ days old (injured/inactive,
//     tolerant of a single bye week which is ~14 days)
//   - Data-driven star rating, same approach as analyze-mlb.js / analyze-nhl.js
//
// NOT included in this version:
//   - Week 1 opponent defense — no completed games exist yet to derive yards-allowed from,
//     so the multiplier stays neutral (1.0) until a team has at least one completed game.
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
import { getTeamContext, getPassDefenseMultiplier, getRushDefenseMultiplier } from "../../lib/nfl-team-defense.js";

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

async function findTeamId(abbreviation) {
  const data = await fetchJSON("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=50");
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const match = teams.find(
    (t) => t.team.abbreviation?.toUpperCase() === abbreviation?.toUpperCase()
  );
  return match?.team?.id ?? null;
}

// Injury designations that mean a player shouldn't be recommended for pregame props.
// Questionable/Day-To-Day are kept — real-world Q-tags play more often than not, and
// pregame picks already carry inherent uncertainty.
const EXCLUDED_INJURY_STATUSES = new Set(['Out', 'Doubtful', 'Injured Reserve', 'Suspension']);

function isPlayerOut(injuries) {
  return (injuries || []).some(inj => EXCLUDED_INJURY_STATUSES.has(inj?.status));
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
      if (isPlayerOut(p.injuries)) continue;
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

function buildPlayerProjection(player, gameStats, gamesPlayed, restInfo, opponentDefense, statsToProject) {
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

    // Opponent defense: a defense that allows more passing yards than average
    // boosts both the QB's passing yards and the pass-catchers' receiving yards;
    // rushing yards allowed only applies to the rushing-yards prop.
    const oppMult = stat === 'rushingYards'
      ? getRushDefenseMultiplier(opponentDefense)
      : getPassDefenseMultiplier(opponentDefense);
    blended *= oppMult;

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
      oppMult: Math.round(oppMult * 100) / 100,
      oppDefenseAllowed: opponentDefense ?? null,
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
  if (proj.oppMult != null) { if (proj.oppMult > 1.08) score += 1; if (proj.oppMult < 0.92) score -= 1; }

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
    const oppLine = s.oppMult != null && s.oppMult !== 1.0
      ? `\n    Opp defense: ${stat === 'rushingYards' ? (s.oppDefenseAllowed?.rushYardsAllowedPerGame ?? '?') : (s.oppDefenseAllowed?.passYardsAllowedPerGame ?? '?')} yds/g allowed (mult: ${s.oppMult}x)`
      : '';
    lines.push(
      `  ${label.toUpperCase()}:
    Projection: ${s.blended} (L3=${s.recentAvg ?? '?'} Season=${s.seasonAvg ?? '?'})
    Suggested threshold: Over ${s.threshold} | Edge: ${s.edge}
    Variance (std dev): ${s.stdDev ?? '?'} | Floor (last 5): ${s.floor ?? '?'}
    Trend: ${trendIcon} | Sample: ${s.sampleSize} games${oppLine}`
    );
  }

  return lines.join('\n');
}

// ─── Historical hit rates (feedback loop) ────────────────────────────────────
// /api/halftime/stats aggregates by_stat across EVERY sport's saved picks (keyed
// by whatever literal string is in pick.stat) — filter to this sport's own labels
// so e.g. MLB's "Hits" hit rate doesn't show up as noise in the NFL prompt.
const NFL_STAT_LABELS = new Set(['Passing Yards', 'Rushing Yards', 'Receiving Yards']);

async function fetchStatHitRates() {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://consensus-picks-mvp.vercel.app';

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);

    let data;
    try {
      const res = await fetch(`${baseUrl}/api/halftime/stats?days=90`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      data = await res.json();
    } catch {
      clearTimeout(timer);
      return null;
    }

    if (!data?.success || !data.by_stat) return null;

    const rates = {};
    for (const [stat, d] of Object.entries(data.by_stat)) {
      if (NFL_STAT_LABELS.has(stat) && d.total >= 10 && d.hitRate != null) {
        rates[stat] = { hitRate: d.hitRate, total: d.total };
      }
    }

    return Object.keys(rates).length >= 2 ? rates : null;
  } catch (err) {
    console.log(`[analyze-nfl] fetchStatHitRates error: ${err.message}`);
    return null;
  }
}

async function generateNFLPicks(homeTeam, awayTeam, playerData, existingLegs, legCount, statHitRates = null) {
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
L3 = last 3 games average, opp defense mult = opponent's yards-allowed vs league average
(>1.0 = weak defense, boosts projection; <1.0 = strong defense, suppresses it)

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
- Opponent defense multiplier is already baked into the projection — cite it when it's a meaningful factor (mult > 1.08 or < 0.92)
- Small sample size (<3 games) should lower confidence — mention in risk_flags

${statHitRates ? `HISTORICAL HIT RATES BY STAT (last 90 days, 10+ sample):
${Object.entries(statHitRates).map(([stat, d]) => `- ${stat}: ${d.hitRate}% (${d.total} picks)`).join('\n')}
Use this to calibrate confidence — favor stat types hitting above 60%, be cautious below 50%. Do not override star ratings, but factor this into rationale and risk_flags.
` : ''}For each pick provide:
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
      if (proj.oppMult != null && proj.oppMult < 0.92) risk_flags.push('strong opponent defense');

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
        oppMult:       proj.oppMult ?? 1.0,
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

    const [homeRoster, awayRoster, homeContext, awayContext] = await Promise.all([
      getTeamRoster(homeId),
      getTeamRoster(awayId),
      getTeamContext(homeId, gameDate).catch(() => null),
      getTeamContext(awayId, gameDate).catch(() => null),
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

    async function fetchProjections(players, teamAbbrev, restInfo, opponentDefense) {
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
          const built = buildPlayerProjection(p, log.gameStats, log.gamesPlayed, restInfo, opponentDefense, statsToProject);
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

    // Home players face the away team's defense, and vice versa
    const [homeProjected, awayProjected] = await Promise.all([
      fetchProjections(homePlayers, homeTeam, homeContext, awayContext?.defenseAllowed),
      fetchProjections(awayPlayers, awayTeam, awayContext, homeContext?.defenseAllowed),
    ]);

    const playerData = [...homeProjected, ...awayProjected];

    console.log(`[analyze-nfl] ${awayTeam} @ ${homeTeam}: ${playerData.length}/${homePlayers.length + awayPlayers.length} players with usable projections`);

    if (playerData.length === 0) {
      return res.status(404).json({ error: 'Could not build projections for any players in this game' });
    }

    const statHitRates = await fetchStatHitRates().catch(() => null);
    if (statHitRates) {
      const summary = Object.entries(statHitRates).map(([s, d]) => `${s}=${d.hitRate}%`).join(' ');
      console.log(`[analyze-nfl] Stat hit rates: ${summary} (${Object.keys(statHitRates).length} stats)`);
    }

    const picks = await generateNFLPicks(homeTeam, awayTeam, playerData, existingLegs || [], legCount, statHitRates);

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
        homeCameOffBye: !!homeContext?.cameOffBye,
        awayCameOffBye: !!awayContext?.cameOffBye,
        homeDefenseAllowed: homeContext?.defenseAllowed ?? null,
        awayDefenseAllowed: awayContext?.defenseAllowed ?? null,
      },
    });
  } catch (err) {
    console.error("[analyze-nfl] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
