// FILE LOCATION: api/halftime/scan.js
// Scans live scoreboards for games currently at halftime.
// Returns game metadata needed for the analyze endpoint.
//
// Usage: GET /api/halftime/scan?sports=nba,nhl
// Response: { games: [{ id, sport, league, homeTeam, awayTeam, score, period, clock }] }

const SPORT_CONFIG = {
  nba:  { sport: 'basketball', league: 'nba',  label: 'NBA',  halftimePeriod: 2 },
  nhl:  { sport: 'hockey',     league: 'nhl',  label: 'NHL',  halftimePeriod: 2 },
  mlb:  { sport: 'baseball',   league: 'mlb',  label: 'MLB',  halftimePeriod: 5 }, // 5th inning ~ halfway
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

function isAtHalftime(event, config) {
  const comp = event.competitions?.[0];
  const status = comp?.status;
  const state = status?.type?.state;

  if (state !== 'in') return false;

  const period = status?.period;
  const clock = status?.displayClock || '';
  const description = status?.type?.description?.toLowerCase() || '';

  // NBA: halftime is between periods 2 and 3 — description says "Halftime"
  // or we're in the break after period 2
  if (config.league === 'nba') {
    return description.includes('halftime') || description.includes('half time');
  }

  // NHL: intermission after period 1 or 2
  if (config.league === 'nhl') {
    return description.includes('intermission') || description.includes('end of');
  }

  // MLB: between innings — approximate halftime as innings 4-6
  if (config.league === 'mlb') {
    return period >= 4 && period <= 6 && description.includes('middle');
  }

  return false;
}

function extractGameData(event, config) {
  const comp = event.competitions?.[0];
  const status = comp?.status;
  const competitors = comp?.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');

  return {
    id: event.id,
    sport: config.sport,
    league: config.league,
    label: config.label,
    name: event.name,
    shortName: event.shortName,
    homeTeam: {
      id: home?.team?.id,
      name: home?.team?.displayName,
      abbreviation: home?.team?.abbreviation,
      score: parseInt(home?.score || '0'),
      logo: home?.team?.logo,
    },
    awayTeam: {
      id: away?.team?.id,
      name: away?.team?.displayName,
      abbreviation: away?.team?.abbreviation,
      score: parseInt(away?.score || '0'),
      logo: away?.team?.logo,
    },
    period: status?.period,
    clock: status?.displayClock,
    statusDescription: status?.type?.description,
    startTime: comp?.date,
    venue: comp?.venue?.fullName || null,
    scoreDiff: Math.abs(parseInt(home?.score || '0') - parseInt(away?.score || '0')),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestedSports = (req.query.sports || 'nba,nhl').split(',').map(s => s.trim().toLowerCase());

  try {
    // Fetch all requested scoreboards in parallel
    const scoreboard_fetches = requestedSports.map(async (sportKey) => {
      const config = SPORT_CONFIG[sportKey];
      if (!config) return [];

      const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard`;
      const data = await fetchWithTimeout(url);
      if (!data?.events) return [];

      const halftimeGames = data.events.filter(e => isAtHalftime(e, config));
      return halftimeGames.map(e => extractGameData(e, config));
    });

    const results = await Promise.all(scoreboard_fetches);
    const games = results.flat();

    console.log(`[halftime/scan] Found ${games.length} halftime games across ${requestedSports.join(', ')}`);

    return res.status(200).json({
      success: true,
      games,
      total: games.length,
      scanned_at: new Date().toISOString(),
      sports_scanned: requestedSports,
    });

  } catch (err) {
    console.error('[halftime/scan] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
