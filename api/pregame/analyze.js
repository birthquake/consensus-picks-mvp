// FILE LOCATION: api/pregame/analyze.js
// Pre-game prop pick generator.
// Unlike halftime analysis (which uses live box scores), this works entirely
// from historical data + contextual factors:
//   - Last 5, last 10, season averages per stat
//   - Variance (std dev) over last 10 → determines cushion on threshold
//   - Back-to-back detection (days since last game)
//   - Home/away split averages
//   - Opponent defensive rating vs position/stat
//   - Rest-adjusted and opponent-adjusted projection
//   - Directional factors → threshold and star rating
//
// Usage: POST /api/pregame/analyze
// Body: { gameId, sport, league, homeTeam, awayTeam, gameDate, existingLegs?, legCount? }

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STAT_KEYS = ['points', 'rebounds', 'assists', 'steals', 'blocks'];

// Regression weight per stat (how much to pull current trend toward season avg)
const REGRESSION_WEIGHT = { points: 0.40, rebounds: 0.30, assists: 0.30, steals: 0.25, blocks: 0.25 };

// Variance thresholds → cushion in stat units
const VARIANCE_CUSHION = {
  points:   { low: [0, 4,  2], mid: [4, 8,  4], high: [8, 999, 6] },
  rebounds: { low: [0, 2,  1], mid: [2, 4,  2], high: [4, 999, 3] },
  assists:  { low: [0, 2,  1], mid: [2, 4,  2], high: [4, 999, 3] },
  steals:   { low: [0, 1, 0.5],mid: [1, 2,  1], high: [2, 999, 1.5] },
  blocks:   { low: [0, 1, 0.5],mid: [1, 2,  1], high: [2, 999, 1.5] },
};

async function fetchWithTimeout(url, ms = 5000) {
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

// ─── Schedule / roster ────────────────────────────────────────────────────────

async function getGameRoster(sport, league, gameId) {
  // Pull the pre-game summary to get projected starters / roster
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${gameId}`;
  const data = await fetchWithTimeout(url, 6000);
  if (!data) return null;

  // Pre-game summaries have rosters in data.rosters or data.leaders
  // Fall back to fetching team rosters directly
  const competitors = data.header?.competitions?.[0]?.competitors || [];
  const teams = competitors.map(c => ({
    id: c.team?.id,
    abbreviation: c.team?.abbreviation,
    displayName: c.team?.displayName,
    homeAway: c.homeAway,
  }));

  return { teams, rawSummary: data };
}

async function findTeamId(sport, league, abbreviation) {
  if (!abbreviation) return null;
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams?limit=50`;
    const data = await fetchWithTimeout(url, 4000);
    const teamList = data?.sports?.[0]?.leagues?.[0]?.teams || data?.teams || [];
    const match = teamList.find(t => {
      const team = t.team || t;
      return team.abbreviation?.toUpperCase() === abbreviation?.toUpperCase();
    });
    return match?.team?.id || match?.id || null;
  } catch {
    return null;
  }
}

async function getTeamRoster(sport, league, teamId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/roster`;
  const data = await fetchWithTimeout(url, 5000);
  if (!data) return [];

  const athletes = data.athletes || [];

  // ESPN roster shape varies:
  // Shape A (flat): data.athletes = [{ id, displayName, position, ... }, ...]
  // Shape B (grouped): data.athletes = [{ displayName:"Guards", items:[...] }, ...]
  // Detect by checking if first element has an "id" field (flat) or "items" field (grouped)
  const isFlat = athletes.length > 0 && (athletes[0].id || athletes[0].fullName);

  const players = [];

  if (isFlat) {
    // Flat array — each element IS a player
    for (const p of athletes) {
      if (!p.id) continue;
      players.push({
        id: p.id,
        name: p.displayName || p.fullName,
        position: p.position?.abbreviation,
        jersey: p.jersey,
      });
    }
  } else {
    // Grouped array — each element is a position group containing players
    for (const group of athletes) {
      const items = group.items || group.athletes || group.entries || [];
      for (const p of items) {
        if (!p.id) continue;
        players.push({
          id: p.id,
          name: p.displayName || p.fullName,
          position: p.position?.abbreviation,
          jersey: p.jersey,
        });
      }
    }
  }

  return players;
}

// ─── Historical form ──────────────────────────────────────────────────────────

async function getRecentGameIds(sport, league, gameDate) {
  const base = new Date(gameDate);
  const dates = Array.from({ length: 25 }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() - (i + 1));
    return formatDate(d);
  });

  const responses = await Promise.all(
    dates.map(dateStr =>
      fetchWithTimeout(
        `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${dateStr}`,
        3000
      ).catch(() => null)
    )
  );

  const gameIds = [];
  const gameDateMap = {};
  for (let i = 0; i < responses.length; i++) {
    const data = responses[i];
    if (!data?.events) continue;
    for (const event of data.events) {
      if (event.status?.type?.completed) {
        gameIds.push(event.id);
        gameDateMap[event.id] = dates[i];
      }
    }
  }

  return { gameIds, gameDateMap };
}

// Intentionally empty — replaced by bulk summary approach below

function getHistoricalFormFromMap(athleteId, playerStatsMap) {
  const byGame = playerStatsMap[String(athleteId)] || [];
  if (byGame.length === 0) return null;
  return buildFormData(byGame);
}

function buildFormDataFromGamelog(gamelog) {
  if (!gamelog || gamelog.allGames.length === 0) return null;
  // Convert gamelog format to byGame format expected by buildFormData
  const byGame = gamelog.allGames.map(g => ({
    stats:   g.stats,
    minutes: g.stats.minutes,
    isHome:  null,
    date:    null,
  }));
  return buildFormData(byGame);
}

// Fetch recent game summaries once and extract stats for ALL players simultaneously
// This is the key optimization — O(games) fetches instead of O(players × games)
async function buildPlayerStatsMap(sport, league, gameDate) {
  // Step 1: Get recent game IDs (parallel scoreboard fetches)
  const base = new Date(gameDate);
  const dates = Array.from({ length: 21 }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() - (i + 1));
    return formatDate(d);
  });

  const sbResponses = await Promise.all(
    dates.map(dateStr =>
      fetchWithTimeout(
        `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${dateStr}`,
        3000
      ).catch(() => null)
    )
  );

  const gameIds = [];
  for (const data of sbResponses) {
    if (!data?.events) continue;
    for (const event of data.events) {
      if (event.status?.type?.completed) gameIds.push(event.id);
    }
  }

  // Cap to 25 most recent games — fetched ALL IN PARALLEL for maximum speed
  // A player appears in roughly every other game, so 25 games = ~12 appearances per player
  // Each NBA team plays every 2-3 days. To get 5 games per player we need
  // ~5 × 15 league games/day = 75 total games. Use 60 as a balance.
  const gameIdsToFetch = gameIds.slice(0, 100);
  console.log(`[pregame/analyze] Fetching ${gameIdsToFetch.length} summaries in parallel...`);

  // Fetch in two parallel batches of 30 to avoid overwhelming ESPN
  const [batch1, batch2, batch3] = [gameIdsToFetch.slice(0, 34), gameIdsToFetch.slice(34, 67), gameIdsToFetch.slice(67)];
  const [results1, results2, results3] = await Promise.all([
    Promise.all(batch1.map(id =>
      fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${id}`, 5000).catch(() => null)
    )),
    Promise.all(batch2.map(id =>
      fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${id}`, 5000).catch(() => null)
    )),
    Promise.all(batch3.map(id =>
      fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${id}`, 5000).catch(() => null)
    )),
  ]);
  const summaries = [...results1, ...results2, ...results3];

  // Extract all player stats from all summaries into a single map
  const playerStatsMap = {};

  for (const summary of summaries) {
    if (!summary?.boxscore?.players) continue;
    for (const group of summary.boxscore.players) {
      const statsBlock = group.statistics?.[0];
      if (!statsBlock) continue;
      const keys = statsBlock.keys || [];
      for (const athlete of (statsBlock.athletes || [])) {
        const athleteId = String(athlete.athlete?.id);
        if (!athleteId || !athlete.stats?.length) continue;
        const minutesIdx = keys.indexOf('minutes');
        const minutes = minutesIdx >= 0 ? parseFloat(athlete.stats[minutesIdx]) || 0 : 0;
        if (minutes < 5) continue;
        const stats = {};
        for (const stat of STAT_KEYS) {
          const idx = keys.findIndex(k => k === stat || k.startsWith(stat));
          if (idx >= 0) {
            const val = parseStatValue(String(athlete.stats[idx] ?? ''));
            if (val != null) stats[stat] = val;
          }
        }
        if (!playerStatsMap[athleteId]) playerStatsMap[athleteId] = [];
        if (playerStatsMap[athleteId].length < 8) {
          playerStatsMap[athleteId].push({ stats, minutes, isHome: null, date: null });
        }
      }
    }
  }

  const successfulSummaries = summaries.filter(Boolean).length;
  const playerCount = Object.keys(playerStatsMap).length;
  const gamesPerPlayer = Object.values(playerStatsMap).map(g => g.length);
  const avgGames = gamesPerPlayer.length
    ? Math.round(gamesPerPlayer.reduce((a,b) => a+b, 0) / gamesPerPlayer.length * 10) / 10
    : 0;

  console.log(`[pregame/analyze] Summaries: ${successfulSummaries}/${gameIdsToFetch.length} fetched`);
  console.log(`[pregame/analyze] Players in map: ${playerCount} | Avg games per player: ${avgGames}`);
  console.log(`[pregame/analyze] Games distribution: min=${Math.min(...gamesPerPlayer)||0} max=${Math.max(...gamesPerPlayer)||0}`);

  // Log which of our target players are/aren't in the map
  return playerStatsMap;
}

function buildFormData(byGame) {
  const calc = (games, stat) => {
    const vals = games.map(g => g.stats[stat]).filter(v => v != null && !isNaN(v));
    if (!vals.length) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10;
  };

  const stdDev = (games, stat) => {
    const vals = games.map(g => g.stats[stat]).filter(v => v != null && !isNaN(v));
    if (vals.length < 2) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.round(Math.sqrt(vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length) * 10) / 10;
  };

  const formData = { byGame };
  formData.averages = {
    last5:  Object.fromEntries(STAT_KEYS.map(s => [s, calc(byGame, s)])),
    last10: Object.fromEntries(STAT_KEYS.map(s => [s, calc(byGame, s)])),
  };
  formData.stdDev   = Object.fromEntries(STAT_KEYS.map(s => [s, stdDev(byGame, s)]));
  formData.floor    = Object.fromEntries(STAT_KEYS.map(s => {
    const vals = byGame.map(g => g.stats[s]).filter(v => v != null);
    return [s, vals.length ? Math.min(...vals) : null];
  }));
  formData.ceiling  = Object.fromEntries(STAT_KEYS.map(s => {
    const vals = byGame.map(g => g.stats[s]).filter(v => v != null);
    return [s, vals.length ? Math.max(...vals) : null];
  }));

  const last3 = byGame.slice(0, 2);
  const older = byGame.slice(2);
  formData.trends = {};
  for (const stat of STAT_KEYS) {
    const r = calc(last3, stat);
    const o = calc(older, stat);
    if (!r || !o || o === 0) { formData.trends[stat] = 'neutral'; continue; }
    formData.trends[stat] = r > o * 1.15 ? 'up' : r < o * 0.85 ? 'down' : 'neutral';
  }

  formData.homeAvg = Object.fromEntries(STAT_KEYS.map(s => [s, null]));
  formData.awayAvg = Object.fromEntries(STAT_KEYS.map(s => [s, null]));
  formData.daysSinceLastGame = 2;
  formData.isBackToBack = false;

  return formData;
}

async function getHistoricalForm(sport, league, athleteId, gameDate, sharedGameIds = null, sharedDateMap = null) {
  let recentGameIds, gameDateMap;

  if (sharedGameIds && sharedGameIds.length > 0) {
    recentGameIds = sharedGameIds;
    gameDateMap   = sharedDateMap || {};
  } else {
    const fetched = await getRecentGameIds(sport, league, gameDate);
    recentGameIds = fetched.gameIds;
    gameDateMap   = fetched.gameDateMap;
  }

  if (recentGameIds.length === 0) return null;

  // Cap game IDs to search — no need to search all 190, player plays every 2-3 days
  const gameIdsToSearch = recentGameIds.slice(0, 50);

  const formData = { byGame: [], gameDates: {} };
  const BATCH = 8;

  for (let i = 0; i < gameIdsToSearch.length && formData.byGame.length < 5; i += BATCH) {
    const batch = recentGameIds.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(gameId => extractPlayerGameLine(sport, league, gameId, athleteId, gameDateMap?.[gameId]))
    );
    for (const r of batchResults) {
      if (r && formData.byGame.length < 10) {
        formData.byGame.push(r);
        formData.gameDates[r.gameId] = r.date;
      }
    }
  }

  if (formData.byGame.length === 0) return null;
  return buildFormData(formData.byGame);
}

async function extractPlayerGameLine(sport, league, gameId, athleteId, date) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${gameId}`;
    const summary = await fetchWithTimeout(url, 4000);
    if (!summary?.boxscore?.players) return null;

    for (const group of summary.boxscore.players) {
      const statsBlock = group.statistics?.[0];
      if (!statsBlock) continue;
      const keys = statsBlock.keys || [];
      const athlete = (statsBlock.athletes || []).find(a => String(a.athlete?.id) === String(athleteId));
      if (!athlete?.stats?.length) continue;

      const stats = {};
      for (const stat of STAT_KEYS) {
        const idx = keys.findIndex(k => k === stat || k.startsWith(stat));
        if (idx >= 0) {
          const val = parseStatValue(String(athlete.stats[idx] ?? ''));
          if (val != null) stats[stat] = val;
        }
      }

      const minutesIdx = keys.indexOf('minutes');
      const minutes = minutesIdx >= 0 ? parseFloat(athlete.stats[minutesIdx]) || 0 : 0;
      if (minutes < 5 && !Object.keys(stats).length) return null;

      // Determine home/away for this game
      const competitors = summary.header?.competitions?.[0]?.competitors || [];
      const playerTeamId = group.team?.id;
      const isHome = competitors.find(c => String(c.team?.id) === String(playerTeamId))?.homeAway === 'home';

      return { gameId, date, stats, minutes, isHome };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Season averages ──────────────────────────────────────────────────────────

// Fetches gamelog for a player — returns both season averages AND recent game form
// Single call replaces both getSeasonAverages and per-player summary searches
async function getPlayerGamelog(sport, league, athleteId) {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/${sport}/${league}/athletes/${athleteId}/gamelog`;
  const data = await fetchWithTimeout(url, 4000);
  if (!data) return null;

  // Top-level names array — stat column order for all events
  const names = data.names || [];
  // seasonTypes[0].categories = monthly buckets, each with events array
  const seasonType = data.seasonTypes?.[0];
  const categories = seasonType?.categories || [];

  if (!names.length || !categories.length) return null;

  // Stat index map
  const idx = (name) => names.findIndex(n =>
    n === name || n.startsWith(name.split('-')[0])
  );
  const PTS_I = idx('points');
  const REB_I = idx('totalRebounds');
  const AST_I = idx('assists');
  const STL_I = idx('steals');
  const BLK_I = idx('blocks');
  const MIN_I = idx('minutes');
  const FGP_I = idx('fieldGoalPct');

  // Collect all game entries chronologically (categories are month buckets)
  const allGames = [];
  for (const cat of categories) {
    for (const event of (cat.events || [])) {
      const stats = event.stats || [];
      const parseS = (i) => {
        if (i < 0 || i >= stats.length) return null;
        const s = String(stats[i]);
        // Handle "made-attempted" fractions — take first number
        if (s.includes('-')) return parseFloat(s.split('-')[0]);
        const v = parseFloat(s);
        return isNaN(v) ? null : v;
      };

      const pts = parseS(PTS_I);
      const reb = parseS(REB_I);
      const ast = parseS(AST_I);
      const min = parseS(MIN_I);

      // Skip DNP entries (0 minutes, 0 everything)
      if (min !== null && min < 5 && pts === 0 && reb === 0 && ast === 0) continue;

      allGames.push({
        eventId: event.eventId,
        stats: {
          points:   pts,
          rebounds: reb,
          assists:  ast,
          steals:   parseS(STL_I),
          blocks:   parseS(BLK_I),
          minutes:  min,
          fgPct:    parseS(FGP_I),
        },
      });
    }
  }

  if (allGames.length === 0) return null;

  // Games come back oldest-first from ESPN — reverse to get newest first
  allGames.reverse();

  // Compute averages
  const avg = (games, stat) => {
    const vals = games.map(g => g.stats[stat]).filter(v => v != null && !isNaN(v));
    if (!vals.length) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10;
  };

  const last5  = allGames.slice(0, 5);
  const last10 = allGames.slice(0, 10);
  const season = allGames; // all games = season

  const seasonAvg = {
    points:   avg(season, 'points'),
    rebounds: avg(season, 'rebounds'),
    assists:  avg(season, 'assists'),
    steals:   avg(season, 'steals'),
    blocks:   avg(season, 'blocks'),
    minutes:  avg(season, 'minutes'),
    fgPct:    avg(season, 'fgPct'),
  };

  return { allGames, last5, last10, seasonAvg, gamesPlayed: allGames.length };
}

async function getSeasonAverages(sport, league, athleteId) {
  // Now backed by getPlayerGamelog
  const gamelog = await getPlayerGamelog(sport, league, athleteId);
  if (!gamelog) return null;
  return gamelog.seasonAvg;
}

// ─── Opponent defensive rating ────────────────────────────────────────────────

// Fetches standings data for both teams — used for blowout probability
// and opponent defensive context
async function getTeamStandings(sport, league) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/standings`;
    const data = await fetchWithTimeout(url, 5000);
    if (!data) return null;

    // ESPN standings shape: data.children[].standings.entries[]
    const entries = [];
    const groups = data.children || data.groups || [];
    for (const group of groups) {
      const groupEntries = group.standings?.entries || group.entries || [];
      entries.push(...groupEntries);
    }

    // Build a map of teamId → standing data
    const standingsMap = {};
    for (const entry of entries) {
      const teamId = entry.team?.id;
      if (!teamId) continue;

      // Extract wins, losses, point differential from stats array
      const stats = entry.stats || [];
      const getStat = name => {
        const s = stats.find(s => s.name === name || s.abbreviation === name);
        return s ? parseFloat(s.value ?? s.displayValue) : null;
      };

      standingsMap[teamId] = {
        teamId,
        teamName:  entry.team?.displayName,
        abbrev:    entry.team?.abbreviation,
        wins:      getStat('wins')   ?? getStat('w')  ?? null,
        losses:    getStat('losses') ?? getStat('l')  ?? null,
        winPct:    getStat('winPercent') ?? getStat('pct') ?? null,
        pointDiff: getStat('pointDifferential') ?? getStat('diff') ?? null,
        ppg:       getStat('pointsFor')  ?? getStat('ppg')  ?? null,
        oppPpg:    getStat('pointsAgainst') ?? getStat('oppg') ?? null,
      };
    }

    return standingsMap;
  } catch {
    return null;
  }
}

// Calculates blowout probability and opponent defensive context
// Returns structured context used in projections and Claude prompt
function buildMatchupContext(homeTeamId, awayTeamId, standingsMap) {
  if (!standingsMap) return null;

  const home = standingsMap[String(homeTeamId)];
  const away = standingsMap[String(awayTeamId)];

  if (!home || !away) return null;

  // Win percentage differential — proxy for talent gap
  const homeWinPct = home.winPct || (home.wins / ((home.wins || 0) + (home.losses || 1)));
  const awayWinPct = away.winPct || (away.wins / ((away.wins || 0) + (away.losses || 1)));
  const winPctDiff = Math.abs(homeWinPct - awayWinPct);
  const favoredTeam = homeWinPct >= awayWinPct ? 'home' : 'away';

  // Point differential proxy for expected margin
  const homeDiff = home.pointDiff || 0;
  const awayDiff = away.pointDiff || 0;
  const expectedMargin = Math.abs(homeDiff - awayDiff) * 0.4; // rough game margin estimate

  // Blowout risk tiers
  let blowoutRisk = 'low';
  let blowoutNote = null;
  if (winPctDiff > 0.25 || expectedMargin > 12) {
    blowoutRisk = 'high';
    blowoutNote = `Large talent gap — ${favoredTeam === 'home' ? home.abbrev : away.abbrev} favored heavily, starters may get fewer 4Q minutes`;
  } else if (winPctDiff > 0.15 || expectedMargin > 7) {
    blowoutRisk = 'medium';
    blowoutNote = `Moderate mismatch — possible garbage time for weaker team`;
  }

  // Defensive ratings (points allowed per game — lower = better defense)
  const homeOppPpg = home.oppPpg;
  const awayOppPpg = away.oppPpg;
  
  // League avg NBA ~113 ppg allowed — classify defense
  const classifyDefense = (oppPpg) => {
    if (!oppPpg) return 'unknown';
    if (oppPpg < 109) return 'elite';
    if (oppPpg < 112) return 'good';
    if (oppPpg < 115) return 'average';
    if (oppPpg < 118) return 'poor';
    return 'bottom-tier';
  };

  return {
    home: {
      teamId: homeTeamId,
      abbrev: home.abbrev,
      wins: home.wins, losses: home.losses,
      winPct: Math.round((homeWinPct || 0) * 1000) / 10,
      pointDiff: home.pointDiff,
      oppPpg: homeOppPpg,
      defenseRating: classifyDefense(homeOppPpg),
      // For away players: home team is their opponent
      asOpponent: {
        defenseRating: classifyDefense(homeOppPpg),
        oppPpg: homeOppPpg,
        note: homeOppPpg ? `${home.abbrev} allows ~${homeOppPpg.toFixed(1)} ppg (${classifyDefense(homeOppPpg)} defense)` : null,
      },
    },
    away: {
      teamId: awayTeamId,
      abbrev: away.abbrev,
      wins: away.wins, losses: away.losses,
      winPct: Math.round((awayWinPct || 0) * 1000) / 10,
      pointDiff: away.pointDiff,
      oppPpg: awayOppPpg,
      defenseRating: classifyDefense(awayOppPpg),
      // For home players: away team is their opponent
      asOpponent: {
        defenseRating: classifyDefense(awayOppPpg),
        oppPpg: awayOppPpg,
        note: awayOppPpg ? `${away.abbrev} allows ~${awayOppPpg.toFixed(1)} ppg (${classifyDefense(awayOppPpg)} defense)` : null,
      },
    },
    blowoutRisk,
    blowoutNote,
    expectedMargin: Math.round(expectedMargin * 10) / 10,
    favoredTeam,
    winPctDiff: Math.round(winPctDiff * 1000) / 10,
  };
}

async function getOpponentDefenseRating(sport, league, opponentTeamId, stat) {
  // Now handled by getTeamStandings + buildMatchupContext
  return null;
}

// ─── Projection engine ────────────────────────────────────────────────────────

function buildPreGameProjection(player, seasonAvg, historicalForm, isHome, opponentContext, matchupContext) {
  const projections = {};

  for (const stat of STAT_KEYS) {
    const last5  = historicalForm?.averages?.last5?.[stat];
    const last10 = historicalForm?.averages?.last10?.[stat];
    const season = seasonAvg?.[stat];
    const sd     = historicalForm?.stdDev?.[stat];
    const floor  = historicalForm?.floor?.[stat];
    const ceil   = historicalForm?.ceiling?.[stat];
    const trend  = historicalForm?.trends?.[stat] || 'neutral';
    const homeAvg = historicalForm?.homeAvg?.[stat];
    const awayAvg = historicalForm?.awayAvg?.[stat];
    const isBackToBack = historicalForm?.isBackToBack || false;
    const daysSince = historicalForm?.daysSinceLastGame ?? 2;

    if (last10 == null && season == null) continue;

    // Base projection: weighted blend of last5, last10, season
    const base = last5 != null && last10 != null && season != null
      ? (last5 * 0.40) + (last10 * 0.35) + (season * 0.25)
      : last10 ?? season ?? last5 ?? 0;

    // Home/away adjustment
    let locationAdj = 0;
    if (isHome && homeAvg != null && last10 != null) {
      locationAdj = (homeAvg - last10) * 0.5; // partial weight
    } else if (!isHome && awayAvg != null && last10 != null) {
      locationAdj = (awayAvg - last10) * 0.5;
    }

    // Rest adjustment
    let restAdj = 0;
    if (isBackToBack) {
      // Back-to-back typically drops output ~8-12% for counting stats
      restAdj = -(base * 0.10);
    } else if (daysSince >= 3) {
      // Well rested — slight positive
      restAdj = base * 0.03;
    }

    // Trend adjustment
    let trendAdj = 0;
    if (trend === 'up'   && last5 != null && last10 != null) trendAdj =  (last5 - last10) * 0.3;
    if (trend === 'down' && last5 != null && last10 != null) trendAdj =  (last5 - last10) * 0.3;

    // Final blended projection
    const blended = Math.round((base + locationAdj + restAdj + trendAdj) * 10) / 10;

    // Variance-based cushion
    const cushionConfig = VARIANCE_CUSHION[stat];
    let cushion = 3; // default
    if (cushionConfig && sd != null) {
      if      (sd < cushionConfig.low[1])  cushion = cushionConfig.low[2];
      else if (sd < cushionConfig.mid[1])  cushion = cushionConfig.mid[2];
      else                                  cushion = cushionConfig.high[2];
    }

    // Opponent defense adjustment (points-focused)
    let defenseAdj = 0;
    if (stat === 'points' && opponentContext?.defenseRating) {
      if (opponentContext.defenseRating === 'elite')       defenseAdj = -(blended * 0.08);
      else if (opponentContext.defenseRating === 'good')   defenseAdj = -(blended * 0.04);
      else if (opponentContext.defenseRating === 'poor')   defenseAdj =  (blended * 0.04);
      else if (opponentContext.defenseRating === 'bottom-tier') defenseAdj = (blended * 0.08);
    }

    // Blowout risk adjustment — reduce projection for likely garbage time team
    let blowoutAdj = 0;
    if (matchupContext?.blowoutRisk === 'high') {
      const playerOnFavoredTeam = matchupContext.favoredTeam === (isHome ? 'home' : 'away');
      if (!playerOnFavoredTeam) {
        // Player is on the likely losing team — may play more desperate minutes
        // but efficiency often drops chasing a big lead
        blowoutAdj = -(blended * 0.05);
      } else {
        // Player is on the likely winning team — starters pulled in 4th
        blowoutAdj = -(blended * 0.08);
        cushion += 1.5; // extra cushion since minutes are uncertain
      }
    } else if (matchupContext?.blowoutRisk === 'medium') {
      const playerOnFavoredTeam = matchupContext.favoredTeam === (isHome ? 'home' : 'away');
      if (playerOnFavoredTeam) blowoutAdj = -(blended * 0.04);
    }

    const adjustedBlended = Math.round((blended + defenseAdj + blowoutAdj) * 10) / 10;

    // Additional cushion adjustments
    if (isBackToBack) cushion += 1;          // more uncertainty on B2B
    if (trend === 'up') cushion -= 0.5;      // trending hot → tighter cushion OK
    if (trend === 'down') cushion += 0.5;    // trending cold → more buffer

    // Minimum sportsbook thresholds — no book offers below these
    const SPORTSBOOK_MINIMUMS = {
      points: 10.5, rebounds: 3.5, assists: 2.5, steals: 0.5, blocks: 0.5,
    };

    // Use adjusted blended (accounts for defense + blowout)
    const finalBlended = adjustedBlended;

    // Suggested threshold (round to nearest 0.5, enforce minimum)
    const rawThreshold = finalBlended - cushion;
    const rounded = Math.round(rawThreshold * 2) / 2;
    const threshold = Math.max(rounded, SPORTSBOOK_MINIMUMS[stat] || 0.5);

    // Edge: how far above threshold the projection sits
    const edge = Math.round((finalBlended - threshold) * 10) / 10;

    // Floor check: is suggested threshold below their worst game in last 10?
    const belowFloor = floor != null && threshold <= floor;

    // Sample size — how many games this projection is based on
    const sampleSize = historicalForm?.byGame?.length || 0;
    const lowSample  = sampleSize < 3; // flag if fewer than 3 games

    projections[stat] = {
      last5, last10, season,
      blended: finalBlended,
      rawBlended: blended,
      threshold,
      cushion: Math.round(cushion * 10) / 10,
      edge,
      stdDev: sd,
      floor,
      ceiling: ceil,
      trend,
      isBackToBack,
      daysSinceLastGame: daysSince,
      locationAdj:  Math.round(locationAdj * 10) / 10,
      restAdj:      Math.round(restAdj * 10) / 10,
      trendAdj:     Math.round(trendAdj * 10) / 10,
      defenseAdj:   Math.round((defenseAdj || 0) * 10) / 10,
      blowoutAdj:   Math.round((blowoutAdj || 0) * 10) / 10,
      defenseRating: opponentContext?.defenseRating || null,
      blowoutRisk:   matchupContext?.blowoutRisk || 'low',
      belowFloor,
      isHome,
      sampleSize,
      lowSample,
    };
  }

  return projections;
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

async function generatePRARanking(game, playerData, matchupContext = null) {
  // Build PRA projections for each player
  const praPlayers = playerData.map(p => {
    const proj = p.projections;
    const pts  = proj?.points?.blended   ?? proj?.points?.last5   ?? null;
    const reb  = proj?.rebounds?.blended ?? proj?.rebounds?.last5  ?? null;
    const ast  = proj?.assists?.blended  ?? proj?.assists?.last5   ?? null;

    if (pts == null && reb == null && ast == null) return null;

    const pra = Math.round(((pts || 0) + (reb || 0) + (ast || 0)) * 10) / 10;

    // Consistency score: how many of pts/reb/ast have below-floor flags
    const belowFloorCount = [
      proj?.points?.belowFloor,
      proj?.rebounds?.belowFloor,
      proj?.assists?.belowFloor,
    ].filter(Boolean).length;

    const stdDevs = [
      proj?.points?.stdDev,
      proj?.rebounds?.stdDev,
      proj?.assists?.stdDev,
    ].filter(v => v != null);
    const avgStdDev = stdDevs.length
      ? Math.round(stdDevs.reduce((a, b) => a + b, 0) / stdDevs.length * 10) / 10
      : null;

    const sampleSize = proj?.points?.sampleSize ?? proj?.rebounds?.sampleSize ?? proj?.assists?.sampleSize ?? 0;

    return {
      name:            p.name,
      team:            p.team,
      isHome:          p.isHome,
      pts:             pts   ? Math.round(pts * 10) / 10   : null,
      reb:             reb   ? Math.round(reb * 10) / 10   : null,
      ast:             ast   ? Math.round(ast * 10) / 10   : null,
      pra,
      belowFloorCount,
      avgStdDev,
      sampleSize,
      lowSample:       sampleSize < 3,
      isBackToBack:    proj?.points?.isBackToBack || false,
      ptsTrend:        proj?.points?.trend  || 'neutral',
      rebTrend:        proj?.rebounds?.trend || 'neutral',
      astTrend:        proj?.assists?.trend  || 'neutral',
      ptsFloor:        proj?.points?.floor   ?? null,
      rebFloor:        proj?.rebounds?.floor ?? null,
      astFloor:        proj?.assists?.floor  ?? null,
    };
  }).filter(Boolean);

  // Filter out players with no data at all
  const validPlayers = praPlayers.filter(p => p.pra > 0 && (p.pts || p.reb || p.ast));
  const invalidPlayers = praPlayers.filter(p => !p.pra || (!p.pts && !p.reb && !p.ast));
  
  validPlayers.sort((a, b) => b.pra - a.pra);
  
  console.log(`[pregame/analyze] PRA ranking: ${validPlayers.length} valid, ${invalidPlayers.length} excluded (no data)`);
  
  // Replace praPlayers with filtered + sorted list
  praPlayers.length = 0;
  praPlayers.push(...validPlayers);

  // Build prompt
  const playerLines = praPlayers.map((p, i) => {
    const trends = [
      p.ptsTrend !== 'neutral' ? `pts ${p.ptsTrend}` : null,
      p.rebTrend !== 'neutral' ? `reb ${p.rebTrend}` : null,
      p.astTrend !== 'neutral' ? `ast ${p.astTrend}` : null,
    ].filter(Boolean).join(', ') || 'all neutral';

    const flags = [
      p.isBackToBack ? 'BACK-TO-BACK' : null,
      p.belowFloorCount === 3 ? 'ALL 3 STATS BELOW FLOOR' : p.belowFloorCount > 0 ? `${p.belowFloorCount} stats below floor` : null,
      p.avgStdDev == null ? 'no variance data' : null,
    ].filter(Boolean).join(' | ') || 'none';

    const sampleNote = p.lowSample ? ` ⚠️ LOW SAMPLE (${p.sampleSize} games)` : ` (${p.sampleSize} games)`;
    return `${i + 1}. ${p.name} (${p.team}${p.isHome ? ' HOME' : ' AWAY'})${sampleNote}
   PRA projection: ${p.pra} (pts=${p.pts ?? '?'} reb=${p.reb ?? '?'} ast=${p.ast ?? '?'})
   Floor: pts≥${p.ptsFloor ?? '?'} reb≥${p.rebFloor ?? '?'} ast≥${p.astFloor ?? '?'}
   Trends: ${trends} | Avg std dev: ${p.avgStdDev ?? 'unknown'}
   Flags: ${flags}`;
  }).join('\n\n');

  const praMatchupBlock = matchupContext ? `
MATCHUP CONTEXT:
- Blowout risk: ${matchupContext.blowoutRisk.toUpperCase()}${matchupContext.blowoutNote ? ' — ' + matchupContext.blowoutNote : ''}
- Expected margin: ~${matchupContext.expectedMargin} pts | Favored: ${matchupContext.favoredTeam} team
- ${matchupContext.home.abbrev}: ${matchupContext.home.wins}-${matchupContext.home.losses} | Defense: ${matchupContext.home.defenseRating}
- ${matchupContext.away.abbrev}: ${matchupContext.away.wins}-${matchupContext.away.losses} | Defense: ${matchupContext.away.defenseRating}
NOTE: If blowout risk is HIGH, the favored team's star may play fewer 4th quarter minutes — factor this into PRA ceiling.` : '';

  const prompt = `You are an expert sports bettor. A user wants to bet on which player will have the highest PRA (Points + Rebounds + Assists) tonight in this game. Analyze the projections and identify the single strongest candidate.

GAME: ${game.awayTeam?.name ?? 'Away'} @ ${game.homeTeam?.name ?? 'Home'}
${praMatchupBlock}

PLAYERS RANKED BY PRA PROJECTION (highest to lowest):
${playerLines}

IMPORTANT: Players marked ⚠️ LOW SAMPLE have fewer than 3 games of data — treat their projections as estimates only. If the top candidate has low sample, weight the secondary candidate more heavily or flag confidence as medium/low.

Provide a thorough analysis covering:
1. Your top PRA candidate and why
2. How confident you are based on floor consistency, variance, and trends
3. Any risk factors that could derail them
4. A secondary candidate if the top pick has significant risk

Return ONLY valid JSON, no markdown:
{
  "top_pick": "Full Name",
  "top_pick_team": "ABV",
  "top_pick_pra_projection": 42.1,
  "confidence": "high" | "medium" | "low",
  "confidence_rating": 4,
  "analysis": "3-4 sentence deep analysis of why this player is the best PRA candidate tonight",
  "key_strengths": ["strength 1", "strength 2", "strength 3"],
  "risk_factors": ["risk 1"] or [],
  "secondary_pick": "Full Name or null",
  "secondary_pick_team": "ABV or null",
  "secondary_analysis": "1-2 sentences on secondary or null",
  "rankings": [
    { "rank": 1, "player": "Full Name", "team": "ABV", "pra": 42.1, "pts": 28.1, "reb": 9.2, "ast": 4.8 }
  ]
}`;

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  let raw = msg.content[0].text.replace(/```json[\n]?/g, '').replace(/```[\n]?/g, '').trim();
  
  // Find the outermost JSON object — Claude sometimes adds text before/after
  const jsonStart = raw.indexOf('{');
  const jsonEnd   = raw.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    raw = raw.substring(jsonStart, jsonEnd + 1);
  }

  let result;
  try {
    result = JSON.parse(raw);
  } catch (parseErr) {
    console.error('[pregame/PRA] JSON parse error:', parseErr.message);
    console.error('[pregame/PRA] Raw (first 500):', raw.substring(0, 500));
    console.error('[pregame/PRA] Raw (around error pos 3681):', raw.substring(3600, 3750));
    throw new Error(`Claude response JSON parse failed: ${parseErr.message}`);
  }

  // Attach full ranking from our math (not just Claude's top picks)
  result.full_rankings = praPlayers.map(p => ({
    player: p.name, team: p.team, isHome: p.isHome,
    pra: p.pra, pts: p.pts, reb: p.reb, ast: p.ast,
    belowFloorCount: p.belowFloorCount, isBackToBack: p.isBackToBack,
    sampleSize: p.sampleSize, lowSample: p.lowSample,
  }));

  return result;
}

async function generatePreGamePicks(game, playerData, existingLegs, legCount, matchupContext = null) {
  const playerLines = playerData.map(p => {
    const proj = p.projections;
    if (!proj || Object.keys(proj).length === 0) return null;

    const lines = [`${p.team} | ${p.name} (${p.position ?? '?'})`];

    for (const stat of STAT_KEYS) {
      const s = proj[stat];
      if (!s || s.blended == null) continue;

      const trendIcon = s.trend === 'up' ? '📈' : s.trend === 'down' ? '📉' : '➡️';
      const b2bFlag   = s.isBackToBack ? ' ⚠️ BACK-TO-BACK' : '';
      const floorFlag = s.belowFloor ? ' 🔒 BELOW 10-GAME FLOOR' : '';
      const location  = s.isHome ? 'HOME' : 'AWAY';

      lines.push(
        `  ${stat.toUpperCase()}:${b2bFlag}${floorFlag}
    Projection: ${s.blended} (L5=${s.last5 ?? '?'} L10=${s.last10 ?? '?'} Season=${s.season ?? '?'})
    Suggested threshold: Over ${s.threshold} | Cushion: ${s.cushion} | Edge: ${s.edge}
    Variance (std dev): ${s.stdDev ?? '?'} | Floor: ${s.floor ?? '?'} | Ceiling: ${s.ceiling ?? '?'}
    Trend: ${trendIcon} ${s.trend} | ${location} | Rest: ${s.daysSinceLastGame ?? '?'}d since last game
    Adjustments: location ${s.locationAdj > 0 ? '+' : ''}${s.locationAdj} | rest ${s.restAdj > 0 ? '+' : ''}${s.restAdj} | trend ${s.trendAdj > 0 ? '+' : ''}${s.trendAdj}`
      );
    }

    return lines.join('\n');
  }).filter(Boolean).join('\n\n');

  const existingLegsText = existingLegs.length > 0
    ? `\nEXISTING LEGS (exclude these players):\n${existingLegs.map((l, i) => `${i + 1}. ${l.player} - ${l.stat}`).join('\n')}\n`
    : '';

  const matchupBlock = matchupContext ? `
MATCHUP CONTEXT:
- Blowout risk: ${matchupContext.blowoutRisk.toUpperCase()}${matchupContext.blowoutNote ? ' — ' + matchupContext.blowoutNote : ''}
- Expected margin: ~${matchupContext.expectedMargin} points (favors ${matchupContext.favoredTeam} team)
- ${matchupContext.home.abbrev} record: ${matchupContext.home.wins}-${matchupContext.home.losses} (${matchupContext.home.winPct}%) | Defense: ${matchupContext.home.defenseRating} (${matchupContext.home.oppPpg ? matchupContext.home.oppPpg.toFixed(1) + ' ppg allowed' : 'unknown'})
- ${matchupContext.away.abbrev} record: ${matchupContext.away.wins}-${matchupContext.away.losses} (${matchupContext.away.winPct}%) | Defense: ${matchupContext.away.defenseRating} (${matchupContext.away.oppPpg ? matchupContext.away.oppPpg.toFixed(1) + ' ppg allowed' : 'unknown'})` : '';

  const prompt = `You are an expert sports bettor generating pre-game prop pick recommendations. You have detailed historical projections for each player including variance-adjusted thresholds, trend data, rest factors, home/away splits, opponent defensive ratings, and blowout probability.

GAME: ${game.awayTeam?.name ?? 'Away'} @ ${game.homeTeam?.name ?? 'Home'}
TIPOFF: ${game.gameDate}
${matchupBlock}
${existingLegsText}

PLAYER PROJECTIONS (pre-game, no live box score available):
${playerLines}

HOW TO USE THESE PROJECTIONS:

THRESHOLD LOGIC:
- "Suggested threshold" = blended projection minus variance cushion
- A larger cushion means higher variance player — threshold is conservative on purpose
- "BELOW 10-GAME FLOOR" = extremely strong pick — player hasn't gone this low in 10 games
- "Edge" = how many units of cushion between projection and threshold

MINIMUM SPORTSBOOK THRESHOLDS (never recommend below these — no sportsbook offers lower):
- Points: minimum 10.5
- Rebounds: minimum 3.5
- Assists: minimum 2.5
- Steals: minimum 0.5 (but prefer 1.5+)
- Blocks: minimum 0.5 (but prefer 1.5+)

If the suggested threshold from the data falls below these minimums, round UP to the minimum.
If even at the minimum the projection doesn't offer meaningful edge, skip that pick entirely.

RATING FRAMEWORK (1-5 stars):
5 stars: projection well above threshold + trending up + good rest + below floor flag + favorable defense
4 stars: projection above threshold + at least 2 positive factors aligned
3 stars: projection above threshold + mixed signals
2 stars: projection above threshold but back-to-back OR high variance OR trending down OR high blowout risk
1 star: only marginal edge or significant risk flags
DEDUCT 1 star for: high blowout risk for player on favored team, elite opposing defense, low sample size (<3 games)
ADD 0.5 stars (round up) for: poor/bottom-tier opposing defense, player on underdog team in blowout (more minutes chasing)

FACTORS TO WEIGH:
- Back-to-back (⚠️): significant risk — drop rating by 1 star minimum
- Below floor (🔒): extremely strong signal — raise rating, mention explicitly in rationale
- Trend up (📈) + good rest (3+ days): strong combination
- High std dev with small edge: risky — mention in risk_flags
- Away game for a player with significant home/away split: note explicitly
- If L5 avg is significantly above L10: player is hot, weight threshold closer to L5

For each pick provide:
- player: exact full name
- team: team abbreviation
- stat: one of "Points", "Rebounds", "Assists", "Steals", "Blocks"
- direction: always "Over" for pre-game recommendations (we back players to perform)
- threshold: the exact number to bet Over on (use the suggested threshold from the data)
- projection: the blended projection number
- edge: cushion between projection and threshold
- rationale: 2-3 sentences citing SPECIFIC numbers — projection, threshold, trend, rest
- rating: 1-5 stars
- rating_reason: one sentence explaining the rating
- risk_flags: array of concern strings (empty if clean)

Return ONLY valid JSON, no markdown:
{
  "game_summary": "2-3 sentences on the matchup and what to watch",
  "picks": [
    {
      "player": "Full Name",
      "team": "ABV",
      "stat": "Points",
      "direction": "Over",
      "threshold": 24.5,
      "projection": 29.2,
      "edge": 4.7,
      "rationale": "...",
      "rating": 4,
      "rating_reason": "...",
      "risk_flags": []
    }
  ]
}

Recommend exactly ${legCount} picks if ${legCount} strong options exist. Never pad with weak picks. Prioritize picks where multiple factors align — below-floor flags, clean rest, positive trend, and meaningful edge all pointing the same direction.`;

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }],
  });

  let raw = msg.content[0].text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const jsonStart = raw.indexOf('{');
  const jsonEnd   = raw.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) raw = raw.substring(jsonStart, jsonEnd + 1);
  try {
    return JSON.parse(raw);
  } catch (parseErr) {
    console.error('[pregame/picks] JSON parse error at pos', parseErr.message);
    console.error('[pregame/picks] Raw snippet:', raw.substring(0, 300));
    throw new Error(`Claude response JSON parse failed: ${parseErr.message}`);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameId, sport, league, homeTeam, awayTeam, gameDate, existingLegs, legCount = 4, mode = 'picks' } = req.body;

  if (!gameId || !sport || !league) {
    return res.status(400).json({ error: 'Missing required fields: gameId, sport, league' });
  }

  try {
    console.log(`[pregame/analyze] Analyzing ${gameId} (${league.toUpperCase()})`);

    // Step 1: Get rosters for both teams
    console.log(`[pregame/analyze] homeTeam:`, JSON.stringify(homeTeam));
    console.log(`[pregame/analyze] awayTeam:`, JSON.stringify(awayTeam));

    // If team IDs are missing, try to find them via the teams endpoint
    const resolvedHomeId = homeTeam?.id || await findTeamId(sport, league, homeTeam?.abbreviation);
    const resolvedAwayId = awayTeam?.id || await findTeamId(sport, league, awayTeam?.abbreviation);

    console.log(`[pregame/analyze] resolvedHomeId: ${resolvedHomeId}, resolvedAwayId: ${resolvedAwayId}`);

    const [homeRoster, awayRoster] = await Promise.all([
      resolvedHomeId ? getTeamRoster(sport, league, resolvedHomeId) : [],
      resolvedAwayId ? getTeamRoster(sport, league, resolvedAwayId) : [],
    ]);

    console.log(`[pregame/analyze] homeRoster: ${homeRoster.length}, awayRoster: ${awayRoster.length}`);

    // Tag players with home/away and limit to likely rotation players
    // Cap at 8 per team (16 total) to stay within time budget
    // Take full roster (up to 13 per team = full NBA rotation)
    // Roster comes back alphabetical from ESPN so we need all of them to get stars like Jokic (J)
    const homePlayers = homeRoster.slice(0, 13).map(p => ({ ...p, isHome: true,  teamAbbrev: homeTeam?.abbreviation || 'HME' }));
    const awayPlayers = awayRoster.slice(0, 13).map(p => ({ ...p, isHome: false, teamAbbrev: awayTeam?.abbreviation || 'AWY' }));
    const allPlayers  = [...homePlayers, ...awayPlayers];

    console.log(`[pregame/analyze] Analyzing ${allPlayers.length} players (up to 13 per team)`);

    // Step 2: Fetch gamelogs + standings in parallel
    // Each player's gamelog gives us BOTH form data AND season averages in one call
    console.log(`[pregame/analyze] Fetching gamelogs + standings...`);
    const [gamelogResults, standingsMap] = await Promise.all([
      Promise.all(allPlayers.map(p =>
        getPlayerGamelog(sport, league, p.id).catch(() => null)
      )),
      getTeamStandings(sport, league),
    ]);

    const matchupContext = buildMatchupContext(resolvedHomeId, resolvedAwayId, standingsMap);
    console.log(`[pregame/analyze] Matchup context: blowout risk=${matchupContext?.blowoutRisk || 'unknown'}, margin=${matchupContext?.expectedMargin || '?'}`);
    console.log(`[pregame/analyze] Gamelogs: ${gamelogResults.filter(Boolean).length}/${allPlayers.length} fetched`);

    // Step 3: Build form + season averages from gamelogs (already fetched above)
    const formResults = gamelogResults.map(gl => {
      if (!gl || gl.allGames.length === 0) return null;
      return buildFormDataFromGamelog(gl);
    });

    const seasonResults = gamelogResults.map(gl => gl?.seasonAvg || null);

    console.log(`[pregame/analyze] Form: ${formResults.filter(Boolean).length}/${allPlayers.length} | Season: ${seasonResults.filter(Boolean).length}/${allPlayers.length}`);
    allPlayers.forEach((p, i) => {
      const games = gamelogResults[i]?.allGames?.length || 0;
      if (games > 0) console.log(`  ${p.name}: ${games} games, season avg pts=${seasonResults[i]?.points ?? '?'}`);
    });

    // Step 4: Build projections, filter to players with enough data
    const playerData = allPlayers.map((p, i) => {
      const form   = formResults[i];
      const season = seasonResults[i];
      if (!form && !season) return null;

      // Opponent is the other team
      const opponentContext = p.isHome
        ? matchupContext?.away?.asOpponent
        : matchupContext?.home?.asOpponent;
      const projections = buildPreGameProjection(p, season, form, p.isHome, opponentContext, matchupContext);
      if (Object.keys(projections).length === 0) return null;

      return {
        id:          p.id,
        name:        p.name,
        position:    p.position,
        team:        p.teamAbbrev,
        isHome:      p.isHome,
        projections,
        form,
        season,
      };
    }).filter(Boolean);

    console.log(`[pregame/analyze] Built projections for ${playerData.length} players`);

    if (playerData.length === 0) {
      return res.status(404).json({ error: 'Could not build projections for any players in this game' });
    }

    // Step 5: Claude analysis
    if (mode === 'pra') {
      const analysis = await generatePRARanking(
        { homeTeam, awayTeam, gameDate },
        playerData,
        matchupContext,
      );
      return res.status(200).json({
        success: true,
        gameId,
        game: { homeTeam, awayTeam, sport, league, gameDate },
        mode: 'pra',
        ...analysis,
        player_count: playerData.length,
        analyzed_at: new Date().toISOString(),
      });
    }

    const picks = await generatePreGamePicks(
      { homeTeam, awayTeam, gameDate },
      playerData,
      existingLegs || [],
      legCount,
      matchupContext,
    );

    return res.status(200).json({
      success: true,
      gameId,
      game: { homeTeam, awayTeam, sport, league, gameDate },
      ...picks,
      player_count: playerData.length,
      analyzed_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[pregame/analyze] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseStatValue(raw) {
  if (!raw || raw === '--' || raw === '-') return null;
  const s = String(raw).trim();
  if (s.includes('-') && !s.startsWith('-')) return parseInt(s.split('-')[0], 10) || null;
  if (s.startsWith('+')) return parseFloat(s.slice(1)) || null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}
