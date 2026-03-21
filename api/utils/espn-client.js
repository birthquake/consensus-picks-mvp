// FILE LOCATION: api/utils/espn-client.js
// ESPN public API client — single-call box score fetching
// Replaces SerpAPI-based result lookup entirely.
//
// Core strategy:
//   1. Hit the scoreboard for the sport + date to find matching game IDs
//   2. Hit the summary endpoint (one call) to get the full inline box score
//   3. Fuzzy-match the player name against boxscore.players[].athletes[].displayName
//   4. Map the bet stat label to the ESPN keys[] index, read stats[index]

// ─── Sport config ────────────────────────────────────────────────────────────

const SPORT_CONFIG = {
  NFL:  { sport: 'football',   league: 'nfl' },
  NBA:  { sport: 'basketball', league: 'nba' },
  MLB:  { sport: 'baseball',   league: 'mlb' },
  NHL:  { sport: 'hockey',     league: 'nhl' },
  NCAAF:{ sport: 'football',   league: 'college-football' },
  NCAAB:{ sport: 'basketball', league: 'mens-college-basketball' },
};

// ─── Stat name normalization ──────────────────────────────────────────────────
// Maps the bet slip label (as extracted by Claude) → ESPN key name in the
// boxscore.players[].statistics[0].keys[] array.

const STAT_KEY_MAP = {
  // NBA / general basketball
  'points':              'points',
  'pts':                 'points',
  'rebounds':            'rebounds',
  'reb':                 'rebounds',
  'total rebounds':      'rebounds',
  'assists':             'assists',
  'ast':                 'assists',
  'steals':              'steals',
  'stl':                 'steals',
  'blocks':              'blocks',
  'blk':                 'blocks',
  'turnovers':           'turnovers',
  'to':                  'turnovers',
  'three pointers':      'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
  'threes':              'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
  '3-pointers made':     'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
  'three pointers made': 'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
  'minutes':             'minutes',

  // NFL
  'passing yards':       'passingYards',
  'pass yards':          'passingYards',
  'rushing yards':       'rushingYards',
  'rush yards':          'rushingYards',
  'receiving yards':     'receivingYards',
  'rec yards':           'receivingYards',
  'receptions':          'receptions',
  'rec':                 'receptions',
  'touchdowns':          'passingTouchdowns',
  'passing touchdowns':  'passingTouchdowns',
  'passing tds':         'passingTouchdowns',
  'rushing touchdowns':  'rushingTouchdowns',
  'receiving touchdowns':'receivingTouchdowns',
  'interceptions':       'interceptions',
  'int':                 'interceptions',
  'completions':         'completions',
  'attempts':            'passingAttempts',
  'sacks':               'sacks',

  // NHL
  'shots on goal':       'shots',
  'shots':               'shots',
  'goals':               'goals',
  'saves':               'saves',
  'plus minus':          'plusMinus',
  '+/-':                 'plusMinus',
  'assists':             'assists',
  'points':              'points',
  'pts':                 'points',
  'power play goals':    'powerPlayGoals',
  'power play points':   'powerPlayPoints',
  'time on ice':         'timeOnIce',
  'toi':                 'timeOnIce',
  'penalty minutes':     'penaltyMinutes',
  'pim':                 'penaltyMinutes',
  'blocked shots':       'blockedShots',
  'hits':                'hits',

  // MLB - pitcher props
  'strikeouts':          'strikeouts',
  'ks':                  'strikeouts',
  'pitcher strikeouts':  'strikeouts',
  'earned runs':         'earnedRuns',
  'era':                 'earnedRunAverage',
  'walks':               'walks',
  'bb':                  'walks',
  'innings pitched':     'inningsPitched',
  'ip':                  'inningsPitched',
  'hits allowed':        'hitsAllowed',
  'pitching outs':       'outsPitched',
  // MLB - batter props
  'hits':                'hits',
  'home runs':           'homeRuns',
  'hr':                  'homeRuns',
  'rbis':                'RBI',
  'rbi':                 'RBI',
  'runs':                'runs',
  'runs scored':         'runs',
  'stolen bases':        'stolenBases',
  'sb':                  'stolenBases',
  'total bases':         'totalBases',
  'tb':                  'totalBases',
  'singles':             'singles',
  'doubles':             'doubles',
  'triples':             'triples',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up a player's stat for a specific game.
 *
 * @param {string} sport      - "NFL", "NBA", "MLB", "NHL" etc.
 * @param {string} playerName - Name as extracted from bet slip (may be partial)
 * @param {string} statLabel  - Stat name as extracted from bet slip
 * @param {string} gameDate   - ISO date string or YYYY-MM-DD of the game
 * @returns {{ found: boolean, value: number|null, finalValue: number|null,
 *             gameId: string|null, playerFullName: string|null,
 *             gameStatus: string, error: string|null }}
 */
export async function getPlayerStatForGame(sport, playerName, statLabel, gameDate) {
  try {
    const config = SPORT_CONFIG[sport?.toUpperCase()];
    if (!config) {
      return { found: false, value: null, finalValue: null, gameId: null,
               playerFullName: null, gameStatus: 'unknown',
               error: `Unsupported sport: ${sport}` };
    }

    // 1. Find the game ID on this date
    const gameId = await findGameIdForPlayer(config, playerName, gameDate);
    if (!gameId) {
      return { found: false, value: null, finalValue: null, gameId: null,
               playerFullName: null, gameStatus: 'not_found',
               error: `No game found for ${playerName} on ${gameDate}` };
    }

    // 2. Fetch the full box score summary (one call)
    const summary = await fetchGameSummary(config, gameId);
    if (!summary) {
      return { found: false, value: null, finalValue: null, gameId,
               playerFullName: null, gameStatus: 'fetch_error',
               error: 'Could not fetch game summary' };
    }

    // 3. Check game status
    const gameStatus = getGameStatus(summary);

    // 4. Find the player and stat
    const result = extractPlayerStat(summary, playerName, statLabel);

    return {
      found: result.found,
      value: result.value,
      finalValue: result.value,
      gameId,
      playerFullName: result.playerFullName,
      gameStatus,
      statKey: result.statKey,
      error: result.error || null,
    };

  } catch (err) {
    console.error(`[espn-client] getPlayerStatForGame error:`, err.message);
    return { found: false, value: null, finalValue: null, gameId: null,
             playerFullName: null, gameStatus: 'error', error: err.message };
  }
}

/**
 * Check whether a game is complete (final) for a sport + date.
 * Useful for pre-flight checks before grading bets.
 */
export async function isGameComplete(sport, playerName, gameDate) {
  // Use a sport-appropriate probe stat — 'points' doesn't exist in NHL/MLB box scores
  const probeStat = getProbeStatForSport(sport);
  const result = await getPlayerStatForGame(sport, playerName, probeStat, gameDate);
  return result.gameStatus === 'final';
}

// Returns a stat label that reliably exists in each sport's box score,
// used only for game-existence/status checks (not actual bet grading).
function getProbeStatForSport(sport) {
  const s = (sport || '').toUpperCase();
  if (s === 'NHL') return 'shots on goal';
  if (s === 'MLB') return 'hits';
  return 'points'; // NBA, NFL default
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetch the scoreboard for a sport on a given date and return the event ID
 * for the game that includes the given player's team.
 * We do this by fetching all game names on the date and picking the closest
 * match — we don't need to know the team ahead of time.
 */
async function findGameIdForPlayer(config, playerName, gameDate) {
  const dateStr = formatDateForESPN(gameDate); // YYYYMMDD
  const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard?dates=${dateStr}&limit=50`;

  console.log(`[espn-client] Fetching scoreboard: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[espn-client] Scoreboard fetch failed: ${res.status}`);
    return null;
  }

  const data = await res.json();
  const events = data.events || [];

  if (events.length === 0) {
    console.warn(`[espn-client] No events found for ${config.league} on ${dateStr}`);
    return null;
  }

  // If only one game on the date just return it (common for NFL)
  if (events.length === 1) return events[0].id;

  // Otherwise we need to figure out which game has our player.
  // Strategy: fetch summary for each game and check player names.
  // To avoid too many calls, first try to narrow by team if we can
  // infer it from the player name lookup in game names — but since
  // we don't have a team lookup table we just search all games in parallel
  // (capped at 8 concurrent fetches to be polite).
  const gameIds = events.map(e => e.id);
  const found = await findGameWithPlayer(config, gameIds, playerName);
  return found;
}

async function findGameWithPlayer(config, gameIds, playerName) {
  // Search games in parallel batches of 4
  const batchSize = 4;
  for (let i = 0; i < gameIds.length; i += batchSize) {
    const batch = gameIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(id => checkGameHasPlayer(config, id, playerName))
    );
    const match = batch[results.findIndex(r => r)];
    if (match) return match;
  }
  return null;
}

async function checkGameHasPlayer(config, gameId, playerName) {
  try {
    const summary = await fetchGameSummary(config, gameId);
    if (!summary?.boxscore?.players) return false;
    // Use a sport-appropriate probe stat
    const probeStat = getProbeStatForSport(config.league?.toUpperCase());
    const result = extractPlayerStat(summary, playerName, probeStat);
    return result.found;
  } catch {
    return false;
  }
}

async function fetchGameSummary(config, gameId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/summary?event=${gameId}`;
  console.log(`[espn-client] Fetching summary: ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[espn-client] Summary fetch failed: ${res.status} for game ${gameId}`);
    return null;
  }
  return res.json();
}

function getGameStatus(summary) {
  // Try header.competitions[0].status first, fall back to checking boxscore
  try {
    const status = summary?.header?.competitions?.[0]?.status?.type;
    if (status) {
      if (status.completed) return 'final';
      if (status.state === 'in') return 'in_progress';
      if (status.state === 'pre') return 'pre_game';
    }
    // If boxscore has player stats, game has at least started
    const hasStats = summary?.boxscore?.players?.[0]?.statistics?.[0]?.athletes?.some(
      a => a.stats && a.stats.length > 0 && a.stats[1] !== '0'
    );
    return hasStats ? 'in_progress' : 'pre_game';
  } catch {
    return 'unknown';
  }
}

/**
 * Parse the boxscore to find a player by fuzzy name match and return
 * the value for the requested stat.
 */
function extractPlayerStat(summary, playerName, statLabel) {
  const playerGroups = summary?.boxscore?.players;
  if (!playerGroups || playerGroups.length === 0) {
    return { found: false, value: null, playerFullName: null, statKey: null,
             error: 'No boxscore player data in summary' };
  }

  const normalizedStat = normalizeStat(statLabel);

  for (const group of playerGroups) {
    const statsBlock = group.statistics?.[0];
    if (!statsBlock) continue;

    const keys = statsBlock.keys || [];   // e.g. ["minutes","points","rebounds",...]
    const statIndex = findStatIndex(keys, normalizedStat);

    if (statIndex === -1) continue; // this group doesn't have this stat

    const athletes = statsBlock.athletes || [];
    const match = findBestPlayerMatch(athletes, playerName);
    if (!match) continue;

    if (match.didNotPlay || !match.stats || match.stats.length === 0) {
      return { found: true, value: 0, playerFullName: match.athlete?.displayName,
               statKey: keys[statIndex], error: null };
    }

    const rawValue = match.stats[statIndex];
    const value = parseStatValue(rawValue, keys[statIndex]);

    return {
      found: true,
      value,
      playerFullName: match.athlete?.displayName,
      statKey: keys[statIndex],
      error: null,
    };
  }

  return { found: false, value: null, playerFullName: null, statKey: normalizedStat,
           error: `Player "${playerName}" not found in boxscore` };
}

// ─── Matching helpers ─────────────────────────────────────────────────────────

function findBestPlayerMatch(athletes, searchName) {
  if (!searchName) return null;
  const search = normalizeName(searchName);

  let best = null;
  let bestScore = 0;

  for (const athlete of athletes) {
    const fullName = normalizeName(athlete.athlete?.displayName || '');
    const shortName = normalizeName(athlete.athlete?.shortName || '');

    const score = Math.max(
      similarityScore(search, fullName),
      similarityScore(search, shortName),
      // Also try last name only match (common on bet slips)
      lastNameScore(search, fullName),
    );

    if (score > bestScore) {
      bestScore = score;
      best = athlete;
    }
  }

  // Require at least 0.6 similarity to avoid false matches
  return bestScore >= 0.6 ? best : null;
}

function normalizeName(name) {
  return name.toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarityScore(a, b) {
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;

  // Token overlap score
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const intersection = [...aTokens].filter(t => bTokens.has(t)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection / union;
}

function lastNameScore(search, fullName) {
  const lastName = fullName.split(' ').pop();
  if (!lastName || lastName.length < 3) return 0;
  if (search === lastName) return 0.85;
  if (search.includes(lastName) || lastName.includes(search)) return 0.75;
  return 0;
}

// ─── Stat helpers ─────────────────────────────────────────────────────────────

function normalizeStat(statLabel) {
  if (!statLabel) return '';
  const lower = statLabel.toLowerCase().trim();
  return STAT_KEY_MAP[lower] || lower;
}

function findStatIndex(keys, normalizedStat) {
  if (!normalizedStat) return -1;

  // Direct key match
  let idx = keys.indexOf(normalizedStat);
  if (idx !== -1) return idx;

  // Case-insensitive match
  idx = keys.findIndex(k => k.toLowerCase() === normalizedStat.toLowerCase());
  if (idx !== -1) return idx;

  // Partial match (e.g. "threePointFieldGoalsMade" in "threePointFieldGoalsMade-threePointFieldGoalsAttempted")
  idx = keys.findIndex(k => k.toLowerCase().startsWith(normalizedStat.toLowerCase()));
  if (idx !== -1) return idx;

  // The stat key from STAT_KEY_MAP might be a composite (e.g. "threePointFieldGoalsMade-...")
  // Try matching the full composite key
  idx = keys.findIndex(k => k.toLowerCase().includes(normalizedStat.toLowerCase()));
  return idx;
}

/**
 * Parse a raw stat value from the stats array.
 * Some values are plain numbers ("19"), some are fractions ("8-14").
 * For fractions (FG, 3PT, FT), we return the made count (first number).
 */
function parseStatValue(raw, key) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const str = String(raw).trim();

  // Fraction format "made-attempted" → return made count
  if (str.includes('-')) {
    const made = parseInt(str.split('-')[0], 10);
    return isNaN(made) ? 0 : made;
  }

  // "+/-" format
  if (str.startsWith('+')) return parseInt(str.slice(1), 10) || 0;

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// ─── Date helper ──────────────────────────────────────────────────────────────

function formatDateForESPN(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput).replace(/-/g, '');
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}
