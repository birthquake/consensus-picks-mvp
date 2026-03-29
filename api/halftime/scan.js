// FILE LOCATION: api/halftime/scan.js
// Scans live scoreboards for games currently in progress.
// Returns game metadata needed for the analyze endpoint.
//
// Usage: GET /api/halftime/scan?sports=nba,nhl
// Response: { games: [{ id, sport, league, homeTeam, awayTeam, score, period, clock }] }

const SPORT_CONFIG = {
  nba: { sport: 'basketball', league: 'nba', label: 'NBA' },
  nhl: { sport: 'hockey',     league: 'nhl', label: 'NHL' },
  mlb: { sport: 'baseball',   league: 'mlb', label: 'MLB' },
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

function isLive(event) {
  const state = event.competitions?.[0]?.status?.type?.state;
  return state === 'in';
}

function extractGameData(event, config) {
  const comp = event.competitions?.[0];
  const status = comp?.status;
  const competitors = comp?.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');

  const period = status?.period;
  const description = status?.type?.description || '';

  // Human-readable game phase label
  let phaseLabel = description;
  if (config.league === 'nba') {
    if (description.toLowerCase().includes('halftime')) phaseLabel = 'Halftime';
    else if (period) phaseLabel = `Q${period}`;
  } else if (config.league === 'nhl') {
    if (description.toLowerCase().includes('intermission')) phaseLabel = `Intermission`;
    else if (period) phaseLabel = `P${period}`;
  } else if (config.league === 'mlb') {
    phaseLabel = description || `Inning ${period}`;
  }

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
    period,
    clock: status?.displayClock,
    statusDescription: phaseLabel,
    isHalftime: description.toLowerCase().includes('halftime') || description.toLowerCase().includes('intermission'),
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
    const scoreboard_fetches = requestedSports.map(async (sportKey) => {
      const config = SPORT_CONFIG[sportKey];
      if (!config) return [];

      const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard`;
      const data = await fetchWithTimeout(url);
      if (!data?.events) return [];

      const liveGames = data.events.filter(e => isLive(e));
      return liveGames.map(e => extractGameData(e, config));
    });

    const results = await Promise.all(scoreboard_fetches);
    const games = results.flat();

    console.log(`[halftime/scan] Found ${games.length} live games across ${requestedSports.join(', ')}`);

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
