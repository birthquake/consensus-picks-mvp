// FILE LOCATION: api/pregame/odds.js
// Fetches live sportsbook lines from The Odds API for MLB player props.
//
// Markets fetched (all in one request — 1 credit per call):
//   batter_hits, batter_runs_scored, batter_rbis, batter_total_bases,
//   batter_home_runs, pitcher_strikeouts, pitcher_walks, pitcher_outs
//
// Returns a lookup map: { "Player Name:stat" -> line }
// e.g. { "Ozzie Albies:hits" -> 0.5, "Spencer Strider:strikeouts" -> 5.5 }
//
// Falls back gracefully — if API is unavailable or credit limit hit,
// analyze-mlb.js continues using its internal thresholds unchanged.

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

const MARKET_TO_STAT = {
  batter_hits:         'hits',
  batter_runs_scored:  'runs',
  batter_rbis:         'rbi',
  batter_total_bases:  'totalBases',
  batter_home_runs:    'homeRuns',
  pitcher_strikeouts:  'strikeouts',
  pitcher_walks:       'walks',
  pitcher_outs:        'outsRecorded',
};

const MARKETS = Object.keys(MARKET_TO_STAT).join(',');

function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function findEvent(events, homeTeam, awayTeam) {
  const homeNorm = normalizeName(homeTeam);
  const awayNorm = normalizeName(awayTeam);
  return events.find(e => {
    const h = normalizeName(e.home_team);
    const a = normalizeName(e.away_team);
    return (h.includes(homeNorm) || homeNorm.includes(h)) &&
           (a.includes(awayNorm) || awayNorm.includes(a));
  }) ?? null;
}

export async function getGameOdds(homeTeam, awayTeam) {
  if (!ODDS_API_KEY) {
    console.log('[odds] No ODDS_API_KEY set — skipping');
    return null;
  }

  try {
    const eventsUrl = `${ODDS_API_BASE}/sports/baseball_mlb/events?apiKey=${ODDS_API_KEY}`;
    const ctrl1  = new AbortController();
    const timer1 = setTimeout(() => ctrl1.abort(), 6000);
    const eventsRes = await fetch(eventsUrl, { signal: ctrl1.signal });
    clearTimeout(timer1);

    if (!eventsRes.ok) {
      console.log(`[odds] Events fetch failed: HTTP ${eventsRes.status}`);
      return null;
    }

    const events = await eventsRes.json();
    const event  = findEvent(events, homeTeam, awayTeam);

    if (!event) {
      console.log(`[odds] No event found for ${awayTeam} @ ${homeTeam}`);
      return null;
    }

    console.log(`[odds] Found event: ${event.away_team} @ ${event.home_team} (${event.id})`);

    const propsUrl = `${ODDS_API_BASE}/sports/baseball_mlb/events/${event.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${MARKETS}&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm`;
    const ctrl2  = new AbortController();
    const timer2 = setTimeout(() => ctrl2.abort(), 8000);
    const propsRes = await fetch(propsUrl, { signal: ctrl2.signal });
    clearTimeout(timer2);

    if (!propsRes.ok) {
      console.log(`[odds] Props fetch failed: HTTP ${propsRes.status}`);
      return null;
    }

    const propsData = await propsRes.json();
    const remaining = propsRes.headers.get('x-requests-remaining');
    if (remaining != null) console.log(`[odds] Credits remaining: ${remaining}`);

    const lines = {};
    for (const bookmaker of (propsData.bookmakers ?? [])) {
      for (const market of (bookmaker.markets ?? [])) {
        const stat = MARKET_TO_STAT[market.key];
        if (!stat) continue;
        for (const outcome of (market.outcomes ?? [])) {
          if (outcome.name !== 'Over') continue;
          const playerKey = `${normalizeName(outcome.description)}:${stat}`;
          if (lines[playerKey] == null) {
            lines[playerKey] = outcome.point;
          } else {
            lines[playerKey] = Math.round(((lines[playerKey] + outcome.point) / 2) * 2) / 2;
          }
        }
      }
    }

    const count = Object.keys(lines).length;
    console.log(`[odds] Fetched ${count} player prop lines for ${event.away_team} @ ${event.home_team}`);
    return count > 0 ? lines : null;

  } catch (err) {
    console.log(`[odds] Error: ${err.message}`);
    return null;
  }
}

export function getLine(oddsMap, playerName, stat) {
  if (!oddsMap || !playerName || !stat) return null;
  const key = `${normalizeName(playerName)}:${stat}`;
  return oddsMap[key] ?? null;
}
