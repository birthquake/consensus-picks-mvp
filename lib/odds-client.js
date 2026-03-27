// FILE LOCATION: lib/odds-client.js
// Fetches NBA player prop lines from the-odds-api.com (free tier).
// Called by pregame/analyze.js to attach real sportsbook lines to picks.
//
// Free tier limits: 500 requests/month. We fetch all stat markets in one
// call per session using a comma-separated markets param to minimise usage.
//
// Stat market mapping:
//   points    → player_points
//   rebounds  → player_rebounds
//   assists   → player_assists
//   steals    → player_steals
//   blocks    → player_blocks

const MARKET_MAP = {
  points:   'player_points',
  rebounds: 'player_rebounds',
  assists:  'player_assists',
  steals:   'player_steals',
  blocks:   'player_blocks',
};

const ALL_MARKETS = Object.values(MARKET_MAP).join(',');

// Preferred books in priority order — first available line wins
const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm', 'pointsbet', 'bovada'];

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[odds-client] HTTP ${res.status} for ${url.substring(0, 80)}`);
      return null;
    }
    return res.json();
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[odds-client] Fetch failed: ${err.message}`);
    return null;
  }
}

// Normalise a player name for matching:
// "LeBron James" → "lebron james", handles Jr./Sr./III suffixes
function normaliseName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '')
    .replace(/[^a-z ]/g, '')
    .trim();
}

// Fuzzy match — returns true if names are close enough
// Handles "Mo Bamba" vs "Mohamed Bamba", initials, etc.
function namesMatch(a, b) {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (na === nb) return true;
  // Last name + first initial match (e.g. "j embiid" vs "joel embiid")
  const partsA = na.split(' ');
  const partsB = nb.split(' ');
  if (partsA.length >= 2 && partsB.length >= 2) {
    const lastA = partsA[partsA.length - 1];
    const lastB = partsB[partsB.length - 1];
    if (lastA === lastB && (partsA[0][0] === partsB[0][0])) return true;
  }
  return false;
}

/**
 * Fetch all NBA player prop lines for today's games.
 *
 * Returns a nested map:
 *   oddsMap[normalisedPlayerName][stat] = {
 *     line: 27.5,
 *     overOdds: -115,
 *     underOdds: -105,
 *     book: 'draftkings',
 *   }
 *
 * Returns an empty object if the API call fails (graceful degradation).
 */
export async function fetchNBAPlayerProps() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.warn('[odds-client] ODDS_API_KEY not set — skipping odds fetch');
    return {};
  }

  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us&markets=${ALL_MARKETS}&oddsFormat=american&bookmakers=${BOOK_PRIORITY.join(',')}`;

  const data = await fetchWithTimeout(url);
  if (!data || !Array.isArray(data)) return {};

  const oddsMap = {};

  for (const game of data) {
    const bookmakers = game.bookmakers || [];

    // Pick the highest-priority book that has data for this game
    let bestBook = null;
    for (const bookKey of BOOK_PRIORITY) {
      bestBook = bookmakers.find(b => b.key === bookKey);
      if (bestBook) break;
    }
    if (!bestBook) bestBook = bookmakers[0]; // fallback to whatever's available
    if (!bestBook) continue;

    for (const market of (bestBook.markets || [])) {
      // Resolve stat name from market key
      const stat = Object.entries(MARKET_MAP).find(([, v]) => v === market.key)?.[0];
      if (!stat) continue;

      for (const outcome of (market.outcomes || [])) {
        // Each prop has two outcomes: Over and Under
        if (outcome.name !== 'Over') continue; // we only need the line once

        const playerName = normaliseName(outcome.description || outcome.player || '');
        if (!playerName) continue;

        const line = outcome.point;
        if (line == null) continue;

        // Find the matching Under outcome for its odds
        const underOutcome = market.outcomes.find(o =>
          o.name === 'Under' &&
          normaliseName(o.description || o.player || '') === playerName
        );

        if (!oddsMap[playerName]) oddsMap[playerName] = {};
        oddsMap[playerName][stat] = {
          line,
          overOdds:  outcome.price,
          underOdds: underOutcome?.price ?? null,
          book:      bestBook.key,
        };
      }
    }
  }

  const playerCount = Object.keys(oddsMap).length;
  console.log(`[odds-client] Fetched props for ${playerCount} players across ${data.length} games`);

  return oddsMap;
}

/**
 * Look up a real sportsbook line for a specific player + stat.
 * Returns the odds entry or null if not found.
 */
export function getLineForPlayer(oddsMap, playerName, stat) {
  if (!oddsMap || !playerName || !stat) return null;
  const normPlayer = normaliseName(playerName);

  // Try exact normalised match first
  if (oddsMap[normPlayer]?.[stat]) return oddsMap[normPlayer][stat];

  // Try fuzzy match across all keys
  for (const [key, stats] of Object.entries(oddsMap)) {
    if (namesMatch(normPlayer, key) && stats[stat]) return stats[stat];
  }

  return null;
}
