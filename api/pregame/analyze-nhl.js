// api/pregame/analyze-nhl.js
// NHL pregame pick generator — mirrors analyze-mlb.js architecture
// Skaters: shots on goal, points, goals, assists, hits, blocked shots
// Goalies: saves
// Position detection: G = goalie, everything else = skater
// TOI used as a proxy for "is this player getting real ice time?"

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// ─── Sportsbook minimums ────────────────────────────────────────────────────
const SPORTSBOOK_MINIMUMS = {
  shotsOnGoal: 0.5,
  points: 0.5,
  goals: 0.5,
  assists: 0.5,
  hits: 0.5,
  blockedShots: 0.5,
  saves: 10.5,
};

// ─── ESPN helpers ────────────────────────────────────────────────────────────

async function findTeamId(abbreviation) {
  const url =
    "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams";
  const res = await fetch(url);
  const data = await res.json();
  const sports = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const match = sports.find(
    (t) => t.team.abbreviation?.toUpperCase() === abbreviation?.toUpperCase()
  );
  return match?.team?.id ?? null;
}

async function getTeamRoster(teamId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${teamId}/roster`;
  const res = await fetch(url);
  const data = await res.json();

  const players = [];
  const positionGroups = data?.athletes ?? [];

  for (const group of positionGroups) {
    const items = group?.items ?? [];
    for (const p of items) {
      const posAbbr = p?.position?.abbreviation?.toUpperCase() ?? "";
      players.push({
        id: p.id,
        name: p.fullName,
        position: posAbbr,
        isGoalie: posAbbr === "G",
        jersey: p.jersey,
      });
    }
  }

  return players;
}

// Parse TOI string "MM:SS" → decimal minutes
function parseTOI(toiStr) {
  if (!toiStr || toiStr === "--") return 0;
  const parts = String(toiStr).split(":");
  if (parts.length === 2) {
    return parseInt(parts[0], 10) + parseInt(parts[1], 10) / 60;
  }
  return parseFloat(toiStr) || 0;
}

async function getPlayerGamelog(playerId, playerName) {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/${playerId}/gamelog`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  // Find regular season category
  const seasonTypes = data?.seasonTypes ?? [];
  let category = null;
  for (const st of seasonTypes) {
    const cats = st?.categories ?? [];
    for (const c of cats) {
      if (
        c.type === "regularSeason" ||
        c.name?.toLowerCase().includes("regular")
      ) {
        category = c;
        break;
      }
    }
    if (category) break;
  }
  if (!category) {
    // Fallback: use first category with events
    for (const st of seasonTypes) {
      for (const c of st?.categories ?? []) {
        if ((c?.events ?? []).length > 0) {
          category = c;
          break;
        }
      }
      if (category) break;
    }
  }
  if (!category) return null;

  // DEBUG: log raw category keys and column fields to find correct structure
  // TODO: remove once NHL column names are confirmed
  const colNames = category.names ?? category.labels ?? category.displayNames ?? category.abbreviations ?? [];
  if (playerName === 'Nikita Kucherov' || playerName === 'Andrei Vasilevskiy') {
    console.log(`[analyze-nhl] RAW category keys for ${playerName}:`, Object.keys(category));
    console.log(`[analyze-nhl] category.names:`, category.names);
    console.log(`[analyze-nhl] category.labels:`, category.labels);
    console.log(`[analyze-nhl] category.displayNames:`, category.displayNames);
    console.log(`[analyze-nhl] category.abbreviations:`, category.abbreviations);
    console.log(`[analyze-nhl] category.type:`, category.type);
    console.log(`[analyze-nhl] category.name:`, category.name);
    const firstEvent = (category.events ?? [])[0];
    if (firstEvent) {
      console.log(`[analyze-nhl] first event keys:`, Object.keys(firstEvent));
      console.log(`[analyze-nhl] first event stats sample:`, firstEvent.stats?.slice(0, 5));
    }
  }

  const events = category?.events ?? [];
  if (events.length === 0) return null;

  const gamesPlayed = events.length;

  // Build a helper to get a stat value by column name (case-insensitive, abbreviation fallback)
  function getStat(statsArr, targetName, fallbackAbbr) {
    const idx = colNames.findIndex(
      (n) =>
        n?.toLowerCase() === targetName?.toLowerCase() ||
        n?.toLowerCase() === fallbackAbbr?.toLowerCase()
    );
    if (idx === -1) return 0;
    return parseFloat(statsArr[idx]) || 0;
  }

  // Aggregate per-game stats
  const gameStats = events.map((ev) => {
    const s = ev?.stats ?? [];
    return {
      shotsOnGoal: getStat(s, "shotsOnGoal", "SOG"),
      goals: getStat(s, "goals", "G"),
      assists: getStat(s, "assists", "A"),
      points: getStat(s, "points", "PTS"),
      hits: getStat(s, "hits", "HIT"),
      blockedShots: getStat(s, "blockedShots", "BLK"),
      // Goalie stats
      saves: getStat(s, "saves", "SV"),
      shotsAgainst: getStat(s, "shotsAgainst", "SA"),
      goalsAgainst: getStat(s, "goalsAgainst", "GA"),
      // TOI as decimal minutes
      toi: parseTOI(
        s[colNames.findIndex((n) => n?.toLowerCase().includes("toi"))]
      ),
    };
  });

  return { gamesPlayed, gameStats };
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

  // Filter out games with 0 TOI (healthy scratches / DNPs)
  const activeGames = gameStats.filter((g) => g.toi > 0);
  if (activeGames.length < 3) {
    return { skipped: true, reason: "Not enough active game data" };
  }

  const recent = activeGames.slice(-5); // last 5 games
  const season = activeGames;

  // 60/40 blend: recent weighted higher
  function blended(key) {
    const r = avg(recent, key);
    const s = avg(season, key);
    return r * 0.6 + s * 0.4;
  }

  const avgTOI = avg(recent, "toi");

  // Skip if player is getting very little ice time (likely 4th liner / scratch risk)
  if (avgTOI < 8) {
    return { skipped: true, reason: `Low TOI (avg ${avgTOI.toFixed(1)} min)` };
  }

  return {
    skipped: false,
    gamesPlayed,
    avgTOI: avgTOI.toFixed(1),
    shotsOnGoal: blended("shotsOnGoal"),
    goals: blended("goals"),
    assists: blended("assists"),
    points: blended("points"),
    hits: blended("hits"),
    blockedShots: blended("blockedShots"),
    recentGames: recent.length,
    seasonGames: season.length,
  };
}

function buildGoalieProjection(player, gameStats, gamesPlayed) {
  if (gamesPlayed < 2) {
    return { skipped: true, reason: `Only ${gamesPlayed} games in log` };
  }

  const activeGames = gameStats.filter((g) => g.shotsAgainst > 0);
  if (activeGames.length < 2) {
    return { skipped: true, reason: "Not enough starts in gamelog" };
  }

  const recent = activeGames.slice(-5);
  const season = activeGames;

  function blended(key) {
    const r = avg(recent, key);
    const s = avg(season, key);
    return r * 0.55 + s * 0.45;
  }

  return {
    skipped: false,
    gamesPlayed,
    saves: blended("saves"),
    shotsAgainst: blended("shotsAgainst"),
    goalsAgainst: blended("goalsAgainst"),
    savePct: blended("saves") / (blended("saves") + blended("goalsAgainst") + 0.001),
    recentGames: recent.length,
    seasonGames: season.length,
  };
}

// ─── Main pick generator ─────────────────────────────────────────────────────

async function generateNHLPicks(homeTeam, awayTeam, homeProjections, awayProjections) {
  function formatSkater(p, proj) {
    if (proj.skipped) return null;
    const lines = [
      `${p.name} (${p.position}, ${proj.gamesPlayed}GP, avg TOI ${proj.avgTOI}min)`,
      `  SOG: ${proj.shotsOnGoal.toFixed(2)} | PTS: ${proj.points.toFixed(2)} | G: ${proj.goals.toFixed(2)} | A: ${proj.assists.toFixed(2)}`,
      `  Hits: ${proj.hits.toFixed(2)} | Blocks: ${proj.blockedShots.toFixed(2)}`,
    ];
    return lines.join("\n");
  }

  function formatGoalie(p, proj) {
    if (proj.skipped) return null;
    return (
      `${p.name} (G, ${proj.gamesPlayed}GP)\n` +
      `  Saves: ${proj.saves.toFixed(1)} | SA: ${proj.shotsAgainst.toFixed(1)} | GA: ${proj.goalsAgainst.toFixed(2)} | SV%: ${(proj.savePct * 100).toFixed(1)}%`
    );
  }

  const homeSkaterLines = homeProjections
    .filter((x) => !x.player.isGoalie && !x.proj.skipped)
    .map((x) => formatSkater(x.player, x.proj))
    .filter(Boolean)
    .join("\n");

  const awaySkaterLines = awayProjections
    .filter((x) => !x.player.isGoalie && !x.proj.skipped)
    .map((x) => formatSkater(x.player, x.proj))
    .filter(Boolean)
    .join("\n");

  const homeGoalieLines = homeProjections
    .filter((x) => x.player.isGoalie && !x.proj.skipped)
    .map((x) => formatGoalie(x.player, x.proj))
    .filter(Boolean)
    .join("\n");

  const awayGoalieLines = awayProjections
    .filter((x) => x.player.isGoalie && !x.proj.skipped)
    .map((x) => formatGoalie(x.player, x.proj))
    .filter(Boolean)
    .join("\n");

  const prompt = `You are an NHL prop bet analyst. Generate player prop picks for tonight's game.

GAME: ${awayTeam} @ ${homeTeam}

${awayTeam} SKATERS:
${awaySkaterLines || "(no qualified skaters)"}

${awayTeam} GOALIES:
${awayGoalieLines || "(no qualified goalies)"}

${homeTeam} SKATERS:
${homeSkaterLines || "(no qualified skaters)"}

${homeTeam} GOALIES:
${homeGoalieLines || "(no qualified goalies)"}

SPORTSBOOK MINIMUMS (only recommend if projection clears this):
Skaters — shots on goal: 0.5 | points: 0.5 | goals: 0.5 | assists: 0.5 | hits: 0.5 | blocked shots: 0.5
Goalies — saves: 10.5

INSTRUCTIONS:
- Select the 4–8 highest-confidence props from ALL players
- For skaters, shots on goal and points are the most commonly available markets — prioritize these
- For goalies, saves is the primary market
- Only recommend OVER bets when projection clearly exceeds the minimum line
- Provide a 1-sentence rationale citing recent trends or TOI
- Defensemen (D) typically produce more hits/blocks and fewer points — factor this in
- Format EXACTLY as JSON array, no markdown, no preamble:

[
  {
    "player": "Player Name",
    "team": "ABBR",
    "position": "LW",
    "stat": "shotsOnGoal",
    "line": 2.5,
    "pick": "OVER",
    "projection": 3.2,
    "confidence": "high",
    "rationale": "One sentence."
  }
]

Stat name options: shotsOnGoal, points, goals, assists, hits, blockedShots, saves`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content[0].text.trim();

  // Resilient JSON parse
  let picks = [];
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      picks = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("[analyze-nhl] JSON parse error:", e.message);
    console.error("[analyze-nhl] Raw response:", raw.substring(0, 500));
  }

  return picks;
}

// ─── Request handler ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { homeTeam, awayTeam, gameId } = req.body;

  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ error: "homeTeam and awayTeam required" });
  }

  try {
    // Get team IDs
    const [homeId, awayId] = await Promise.all([
      findTeamId(homeTeam),
      findTeamId(awayTeam),
    ]);

    if (!homeId || !awayId) {
      return res.status(404).json({
        error: `Could not find team IDs for ${homeTeam} / ${awayTeam}`,
      });
    }

    // Get rosters
    const [homeRoster, awayRoster] = await Promise.all([
      getTeamRoster(homeId),
      getTeamRoster(awayId),
    ]);

    // Limit to top players to keep within time budget
    // Goalies: take first 2 (starter + backup)
    // Skaters: take first 18 (top 6 F + top 4 D per team is ~10, grab 18 to be safe)
    function trimRoster(roster) {
      const goalies = roster.filter((p) => p.isGoalie).slice(0, 2);
      const skaters = roster.filter((p) => !p.isGoalie).slice(0, 18);
      return [...skaters, ...goalies];
    }

    const homePlayers = trimRoster(homeRoster);
    const awayPlayers = trimRoster(awayRoster);

    // Fetch gamelogs in parallel
    async function fetchProjections(players) {
      const results = await Promise.all(
        players.map(async (p) => {
          const log = await getPlayerGamelog(p.id, p.name);
          if (!log) return { player: p, proj: { skipped: true, reason: "No gamelog data" } };

          const proj = p.isGoalie
            ? buildGoalieProjection(p, log.gameStats, log.gamesPlayed)
            : buildSkaterProjection(p, log.gameStats, log.gamesPlayed);

          return { player: p, proj };
        })
      );
      return results;
    }

    const [homeProjections, awayProjections] = await Promise.all([
      fetchProjections(homePlayers),
      fetchProjections(awayPlayers),
    ]);

    // Generate picks
    const picks = await generateNHLPicks(
      homeTeam,
      awayTeam,
      homeProjections,
      awayProjections
    );

    // Build projections map for UI display
    const projectionsMap = {};
    for (const { player, proj } of [...homeProjections, ...awayProjections]) {
      if (!proj.skipped) {
        projectionsMap[player.name] = {
          ...proj,
          position: player.position,
          isGoalie: player.isGoalie,
        };
      }
    }

    return res.status(200).json({
      picks,
      projections: projectionsMap,
      meta: {
        homeTeam,
        awayTeam,
        homeRosterSize: homePlayers.length,
        awayRosterSize: awayPlayers.length,
        qualifiedSkaters: [...homeProjections, ...awayProjections].filter(
          (x) => !x.player.isGoalie && !x.proj.skipped
        ).length,
        qualifiedGoalies: [...homeProjections, ...awayProjections].filter(
          (x) => x.player.isGoalie && !x.proj.skipped
        ).length,
      },
    });
  } catch (err) {
    console.error("[analyze-nhl] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
