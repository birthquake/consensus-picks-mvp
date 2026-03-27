// FILE LOCATION: lib/odds-client.js
// Fetches NBA player prop lines from the-odds-api.com (free tier).
//
// The correct flow for player props:
//   1. GET /v4/sports/basketball_nba/events  → list of today's game event IDs
//   2. GET /v4/sports/basketball_nba/events/{id}/odds?markets=player_points,...
//      → player props for that specific game
//
// Credit cost: 1 (events list) + 5 markets × N games = ~51 credits for 10 games
// To stay efficient we fetch all 5 markets in one call per game.

const STAT_MARKETS = 'player_points,player_rebounds,player_assists,player_steals,player_blocks';

const STAT_FROM_MARKET = {
  player_points:   'points',
  player_rebounds: 'rebounds',
  player_assists:  'assists',
  player_steals:   'steals',
  player_blocks:   'blocks',
};

// Preferred books in priority order
const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'bovada'];

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[odds-client] HTTP ${res.status}: ${url.substring(0, 100)}`);
      return null;
    }
    return res.json();
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[odds-client] Fetch error: ${err.message}`);
    return null;
  }
}

function normaliseName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '')
    .replace(/[^a-z ]/g, '')
    .trim();
}

function namesMatch(a, b) {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (na === nb) return true;
  const partsA = na.split(' ');
  const partsB = nb.split(' ');
  if (partsA.length >= 2 && partsB.length >= 2) {
    const lastA = partsA[partsA.length - 1];
    const lastB = partsB[partsB.length - 1];
    if (lastA === lastB && partsA[0][0] === partsB[0][0]) return true;
  }
  return false;
}

/**
 * Fetch all NBA player prop lines for today's games.
 * Returns oddsMap[normalisedPlayerName][stat] = { line, overOdds, underOdds, book }
 * Returns {} on any failure — always degrades gracefully.
 */
export async function fetchNBAPlayerProps() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.warn('[odds-client] ODDS_API_KEY not set — skipping');
    return {};
  }

  // Step 1: Get today's events
  const eventsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${apiKey}`;
  const events = await fetchWithTimeout(eventsUrl);
  if (!Array.isArray(events) || events.length === 0) {
    console.warn('[odds-client] No events returned');
    return {};
  }

  console.log(`[odds-client] Found ${events.length} NBA events — fetching props...`);

  // Step 2: Fetch player props for each event in parallel
  const propResults = await Promise.all(
    events.map(event =>
      fetchWithTimeout(
        `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${STAT_MARKETS}&oddsFormat=american&bookmakers=${BOOK_PRIORITY.join(',')}`
      ).catch(() => null)
    )
  );

  // Step 3: Build the oddsMap
  const oddsMap = {};

  for (const gameOdds of propResults) {
    if (!gameOdds?.bookmakers) continue;

    // Pick highest-priority available book
    let book = null;
    for (const key of BOOK_PRIORITY) {
      book = gameOdds.bookmakers.find(b => b.key === key);
      if (book) break;
    }
    if (!book) book = gameOdds.bookmakers[0];
    if (!book) continue;

    for (const market of (book.markets || [])) {
      const stat = STAT_FROM_MARKET[market.key];
      if (!stat) continue;

      // Group outcomes by player name
      const byPlayer = {};
      for (const outcome of (market.outcomes || [])) {
        // Odds API uses outcome.description for player name on props
        const playerName = outcome.description || outcome.name;
        if (!playerName || !outcome.point) continue;
        if (!byPlayer[playerName]) byPlayer[playerName] = {};
        byPlayer[playerName][outcome.name] = outcome; // 'Over' or 'Under'
      }

      for (const [playerName, sides] of Object.entries(byPlayer)) {
        const over = sides['Over'];
        const under = sides['Under'];
        if (!over) continue;

        const key = normaliseName(playerName);
        if (!oddsMap[key]) oddsMap[key] = {};
        oddsMap[key][stat] = {
          line:      over.point,
          overOdds:  over.price,
          underOdds: under?.price ?? null,
          book:      book.key,
        };
      }
    }
  }

  const playerCount = Object.keys(oddsMap).length;
  console.log(`[odds-client] Built odds map: ${playerCount} players`);
  return oddsMap;
}

/**
 * Look up a real sportsbook line for a specific player + stat.
 */
export function getLineForPlayer(oddsMap, playerName, stat) {
  if (!oddsMap || !playerName || !stat) return null;
  const norm = normaliseName(playerName);

  if (oddsMap[norm]?.[stat]) return oddsMap[norm][stat];

  for (const [key, stats] of Object.entries(oddsMap)) {
    if (namesMatch(norm, key) && stats[stat]) return stats[stat];
  }

  return null;
}
