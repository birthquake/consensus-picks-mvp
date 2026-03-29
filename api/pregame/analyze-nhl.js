// api/pregame/analyze-nhl.js
// NHL pregame pick generator
//
// ESPN gamelog structure (confirmed from logs):
//   data.names[]  — column names at TOP LEVEL (not inside category)
//   data.labels[] — abbreviations at top level
//   category.events[].stats[] — parallel array of values
//
// Skater columns: goals, assists, points, plusMinus, penaltyMinutes,
//   shotsTotal, shootingPct, powerPlayGoals, powerPlayAssists,
//   shortHandedGoals, shortHandedAssists, gameWinningGoals,
//   timeOnIcePerGame, production
//
// Goalie columns: gameStarted, timeOnIcePerGame, wins, losses, ties,
//   overtimeLosses, goalsAgainst, avgGoalsAgainst, shotsAgainst,
//   saves, savePct, shutouts
//
// NOTE: ESPN does not provide hits or blockedShots in the gamelog endpoint.
// shotsTotal is used as the shots prop (total shot attempts).

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// ─── ESPN helpers ────────────────────────────────────────────────────────────

async function findTeamId(abbreviation) {
  const url = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams";
  const res = await fetch(url);
  const data = await res.json();
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const match = teams.find(
    (t) => t.team.abbreviation?.toUpperCase() === abbreviation?.toUpperCase()
  );
  return match?.team?.id ?? null;
}

async function getTeamRoster(teamId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${teamId}/roster`;
  const res = await fetch(url);
  const data = await res.json();

  const players = [];
  for (const group of data?.athletes ?? []) {
    for (const p of group?.items ?? []) {
      const posAbbr = p?.position?.abbreviation?.toUpperCase() ?? "";
      players.push({
        id: p.id,
        name: p.fullName,
        position: posAbbr,
        isGoalie: posAbbr === "G",
      });
    }
  }
  return players;
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
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/${playerId}/gamelog`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  // Column names live at TOP LEVEL of the response (not inside category)
  const colNames = data.names ?? [];
  if (colNames.length === 0) return null;

  // Find first category with events
  let category = null;
  for (const st of data?.seasonTypes ?? []) {
    for (const c of st?.categories ?? []) {
      if ((c?.events ?? []).length > 0) {
        category = c;
        break;
      }
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
      // Skater stats
      goals:        getStat(s, "goals"),
      assists:      getStat(s, "assists"),
      points:       getStat(s, "points"),
      shots:        getStat(s, "shotsTotal"),
      toi:          parseTOI(s[colNames.indexOf("timeOnIcePerGame")]),
      // Goalie stats
      saves:        getStat(s, "saves"),
      shotsAgainst: getStat(s, "shotsAgainst"),
      goalsAgainst: getStat(s, "goalsAgainst"),
      gameStarted:  getStat(s, "gameStarted"),
    };
  });

  return { gamesPlayed: events.length, gameStats };
}

// ─── Projection builders ─────────────────────────────────────────────────────

function avg(arr, key) {
  if (!arr.length) return 0;
  return arr.reduce((sum, g) => sum + (g[key] ?? 0), 0) / arr.length;
}

function buildSkaterProjection(player, gameStats, gamesPlayed) {
  if (gamesPlayed < 3) {
    return { skipped: true, reason: `Only ${gamesPlayed} games in log` };
  }

  const activeGames = gameStats.filter((g) => g.toi > 0);
  if (activeGames.length < 3) {
    return { skipped: true, reason: "Not enough active games" };
  }

  const recentTOI = avg(activeGames.slice(-5), "toi");
  if (recentTOI < 8) {
    return { skipped: true, reason: `Low TOI (avg ${recentTOI.toFixed(1)} min)` };
  }

  const recent = activeGames.slice(-5);
  const season = activeGames;

  function blended(key) {
    return avg(recent, key) * 0.6 + avg(season, key) * 0.4;
  }

  return {
    skipped: false,
    gamesPlayed,
    avgTOI:  recentTOI.toFixed(1),
    shots:   blended("shots"),
    goals:   blended("goals"),
    assists: blended("assists"),
    points:  blended("points"),
    recentGames: recent.length,
    seasonGames: season.length,
  };
}

function buildGoalieProjection(player, gameStats, gamesPlayed) {
  if (gamesPlayed < 2) {
    return { skipped: true, reason: `Only ${gamesPlayed} games in log` };
  }

  const starts = gameStats.filter((g) => g.gameStarted >= 1 || g.shotsAgainst > 0);
  if (starts.length < 2) {
    return { skipped: true, reason: "Not enough starts" };
  }

  const recent = starts.slice(-5);
  const season = starts;

  function blended(key) {
    return avg(recent, key) * 0.55 + avg(season, key) * 0.45;
  }

  const blendedSaves = blended("saves");
  const blendedGA    = blended("goalsAgainst");

  return {
    skipped: false,
    gamesPlayed,
    starts:       starts.length,
    saves:        blendedSaves,
    shotsAgainst: blended("shotsAgainst"),
    goalsAgainst: blendedGA,
    savePct:      blendedSaves / (blendedSaves + blendedGA + 0.001),
    recentGames:  recent.length,
    seasonGames:  season.length,
  };
}

// ─── Pick generator ───────────────────────────────────────────────────────────

async function generateNHLPicks(homeTeam, awayTeam, homeProjections, awayProjections) {
  function skaterLine(p, proj) {
    if (proj.skipped) return null;
    return (
      `${p.name} (${p.position}, ${proj.gamesPlayed}GP, TOI ${proj.avgTOI}min)\n` +
      `  Shots: ${proj.shots.toFixed(2)} | PTS: ${proj.points.toFixed(2)} | G: ${proj.goals.toFixed(2)} | A: ${proj.assists.toFixed(2)}`
    );
  }

  function goalieLine(p, proj) {
    if (proj.skipped) return null;
    return (
      `${p.name} (G, ${proj.starts} starts)\n` +
      `  Saves: ${proj.saves.toFixed(1)} | SA: ${proj.shotsAgainst.toFixed(1)} | GA: ${proj.goalsAgainst.toFixed(2)} | SV%: ${(proj.savePct * 100).toFixed(1)}%`
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
- Pick 4–8 highest-confidence props across all players
- Prioritize shots and points for skaters (most liquid markets)
- Prioritize saves for goalies
- Only recommend OVER when projection clearly clears the typical line
- Defensemen produce fewer points but can have shot volume
- 1-sentence rationale citing recent form or TOI
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
  let picks = [];
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) picks = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("[analyze-nhl] JSON parse error:", e.message);
    console.error("[analyze-nhl] Raw:", raw.substring(0, 500));
  }
  return picks;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { homeTeam, awayTeam, homeTeamId, awayTeamId } = req.body;

  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ error: "homeTeam and awayTeam required" });
  }

  try {
    // Prefer IDs passed from scan to avoid abbreviation mismatch
    const homeId = homeTeamId || await findTeamId(homeTeam);
    const awayId = awayTeamId || await findTeamId(awayTeam);

    if (!homeId || !awayId) {
      return res.status(404).json({
        error: `Could not find team IDs for ${homeTeam} / ${awayTeam}`,
      });
    }

    const [homeRoster, awayRoster] = await Promise.all([
      getTeamRoster(homeId),
      getTeamRoster(awayId),
    ]);

    function trimRoster(roster) {
      const goalies = roster.filter((p) => p.isGoalie).slice(0, 2);
      const skaters = roster.filter((p) => !p.isGoalie).slice(0, 18);
      return [...skaters, ...goalies];
    }

    const homePlayers = trimRoster(homeRoster);
    const awayPlayers = trimRoster(awayRoster);

    async function fetchProjections(players) {
      return Promise.all(
        players.map(async (p) => {
          const log = await getPlayerGamelog(p.id);
          if (!log) return { player: p, proj: { skipped: true, reason: "No gamelog data" } };
          const proj = p.isGoalie
            ? buildGoalieProjection(p, log.gameStats, log.gamesPlayed)
            : buildSkaterProjection(p, log.gameStats, log.gamesPlayed);
          return { player: p, proj };
        })
      );
    }

    const [homeProjections, awayProjections] = await Promise.all([
      fetchProjections(homePlayers),
      fetchProjections(awayPlayers),
    ]);

    const picks = await generateNHLPicks(homeTeam, awayTeam, homeProjections, awayProjections);

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
        homeRosterSize: homePlayers.length,
        awayRosterSize: awayPlayers.length,
        qualifiedSkaters: allProj.filter((x) => !x.player.isGoalie && !x.proj.skipped).length,
        qualifiedGoalies: allProj.filter((x) => x.player.isGoalie  && !x.proj.skipped).length,
      },
    });
  } catch (err) {
    console.error("[analyze-nhl] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
