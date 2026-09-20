// FILE LOCATION: lib/nfl-team-defense.js
// Team-level context for NFL pregame props: bye-week/rest detection, plus
// opponent-defense strength derived from box scores (ESPN's team statistics
// endpoint has no direct "yards allowed" field for NFL — only a team's own
// offensive output and turnover-style defensive stats). To get yards allowed,
// we aggregate the OPPONENT's per-game offensive output across each team's
// own completed games this season, the same box-score-aggregation approach
// api/pregame/analyze.js already uses for NBA player form, just at team level
// and NFL's much smaller scale (at most ~16 games before any given week).

// League-average approximations (2025-26 season), used to normalize a team's
// yards-allowed into a multiplier — same pattern as MLB_AVG / NHL_AVG.
const NFL_AVG = {
  passYardsAllowedPerGame: 215,
  rushYardsAllowedPerGame: 115,
};

const MAX_GAMES_SAMPLED = 8;

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

async function getGameSummary(gameId) {
  return fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`, 5000);
}

// Aggregate yards allowed by teamId across its completed games, by reading
// the OPPONENT's boxscore entry in each game (what they gained = what teamId's
// defense allowed).
async function getDefenseAllowed(teamId, completedGames) {
  const recent = completedGames.slice(-MAX_GAMES_SAMPLED);
  if (!recent.length) return null;

  const summaries = await Promise.all(recent.map(e => getGameSummary(e.id)));

  let passSum = 0, rushSum = 0, count = 0;
  for (const summary of summaries) {
    const teams = summary?.boxscore?.teams ?? [];
    const opponent = teams.find(t => String(t?.team?.id) !== String(teamId));
    if (!opponent) continue;

    const stats = opponent.statistics ?? [];
    const passYards = parseFloat(stats.find(s => s.name === 'netPassingYards')?.displayValue);
    const rushYards = parseFloat(stats.find(s => s.name === 'rushingYards')?.displayValue);
    if (isNaN(passYards) && isNaN(rushYards)) continue;

    if (!isNaN(passYards)) passSum += passYards;
    if (!isNaN(rushYards)) rushSum += rushYards;
    count++;
  }

  if (count === 0) return null;

  return {
    gamesSampled: count,
    passYardsAllowedPerGame: Math.round((passSum / count) * 10) / 10,
    rushYardsAllowedPerGame: Math.round((rushSum / count) * 10) / 10,
  };
}

// Bye-week / rest detection — NFL plays weekly, so "back-to-back" doesn't apply.
// A gap of 10+ days before the target game means the team is coming off a bye —
// treated as a mild positive signal (fresher legs), not a risk flag.
//
// Fetches the team's schedule once and derives both rest info and opponent
// defense strength from it, since both need the same completed-games list.
export async function getTeamContext(teamId, gameDate) {
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

  const defenseAllowed = await getDefenseAllowed(teamId, completed).catch(() => null);

  if (!completed.length) {
    return { lastGameDate: null, daysSinceLastGame: null, cameOffBye: false, defenseAllowed };
  }

  const lastGame = completed[completed.length - 1];
  const lastGameDate = new Date(lastGame.date);
  const diffDays = (target - lastGameDate) / (1000 * 60 * 60 * 24);

  return {
    lastGameDate: lastGame.date,
    daysSinceLastGame: Math.floor(diffDays),
    cameOffBye: diffDays >= 10,
    defenseAllowed,
  };
}

function clampMultiplier(m) {
  return Math.max(0.85, Math.min(1.15, m));
}

export function getPassDefenseMultiplier(defenseAllowed) {
  if (!defenseAllowed?.passYardsAllowedPerGame) return 1.0;
  return clampMultiplier(defenseAllowed.passYardsAllowedPerGame / NFL_AVG.passYardsAllowedPerGame);
}

export function getRushDefenseMultiplier(defenseAllowed) {
  if (!defenseAllowed?.rushYardsAllowedPerGame) return 1.0;
  return clampMultiplier(defenseAllowed.rushYardsAllowedPerGame / NFL_AVG.rushYardsAllowedPerGame);
}
