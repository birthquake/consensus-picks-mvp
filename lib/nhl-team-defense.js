// FILE LOCATION: lib/nhl-team-defense.js
// Team-level NHL context shared between pregame and live analyzers: league
// averages, opponent shots/goals-allowed, and back-to-back/rest detection.
// Mirrors lib/nfl-team-defense.js's role for NFL.

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

// NHL league averages (2024-25 season approximations)
// Used to normalise opponent defensive ratings into a multiplier
export const NHL_AVG = {
  shotsAgainstPerGame: 29.5,  // avg shots a team faces per game
  goalsAgainstPerGame: 3.0,   // avg goals a team allows per game
  savesPerGame: 26.5,         // avg saves a goalie makes per start
};

// Get opponent defensive stats: shots allowed/game and goals allowed/game
// Used to build a multiplier vs league average
// ESPN statistics endpoint returns season TOTALS — must divide by gamesPlayed
export async function getTeamDefenseStats(teamId) {
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

// Get team's last game date for back-to-back detection (always relative to now —
// works the same for a pregame lookup or mid-game live analysis)
export async function getTeamSchedule(teamId) {
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
export function parseTOI(toiStr) {
  if (!toiStr || toiStr === "--") return 0;
  const parts = String(toiStr).split(":");
  if (parts.length === 2) {
    return parseInt(parts[0], 10) + parseInt(parts[1], 10) / 60;
  }
  return parseFloat(toiStr) || 0;
}
