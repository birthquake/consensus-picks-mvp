// FILE LOCATION: api/pregame/scan.js
// Returns today's scheduled and upcoming NBA games.
// Unlike halftime/scan which filters for live halftime games,
// this returns games that haven't started yet (state === 'pre')
// plus any games in the next 24 hours.
//
// Usage: GET /api/pregame/scan?sport=nba

const SPORT_CONFIG = {
  nba: { sport: 'basketball', league: 'nba', label: 'NBA' },
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

function extractGameData(event, config) {
  const comp        = event.competitions?.[0];
  const status      = comp?.status;
  const competitors = comp?.competitors || [];
  const home        = competitors.find(c => c.homeAway === 'home');
  const away        = competitors.find(c => c.homeAway === 'away');

  return {
    id:        event.id,
    sport:     config.sport,
    league:    config.league,
    label:     config.label,
    name:      event.name,
    shortName: event.shortName,
    gameDate:  comp?.date || event.date,
    homeTeam: {
      id:           home?.team?.id,
      name:         home?.team?.displayName,
      abbreviation: home?.team?.abbreviation,
      logo:         home?.team?.logo,
      score:        home?.score ? parseInt(home.score) : null,
    },
    awayTeam: {
      id:           away?.team?.id,
      name:         away?.team?.displayName,
      abbreviation: away?.team?.abbreviation,
      logo:         away?.team?.logo,
      score:        away?.score ? parseInt(away.score) : null,
    },
    state:             status?.type?.state,      // 'pre' | 'in' | 'post'
    statusDescription: status?.type?.description,
    startTime:         comp?.date,
    venue:             comp?.venue?.fullName || null,
    broadcasts:        comp?.broadcasts?.map(b => b.names?.join(', ')).filter(Boolean) || [],
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sportKey = (req.query.sport || 'nba').toLowerCase();
  const config   = SPORT_CONFIG[sportKey];

  if (!config) {
    return res.status(400).json({ error: `Unsupported sport: ${sportKey}` });
  }

  try {
    // Fetch today's scoreboard
    const today    = formatDate(new Date());
    const tomorrow = formatDate(new Date(Date.now() + 86400000));

    const [todayData, tomorrowData] = await Promise.all([
      fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard?dates=${today}`),
      fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard?dates=${tomorrow}`),
    ]);

    const todayGames    = (todayData?.events    || []).map(e => extractGameData(e, config));
    const tomorrowGames = (tomorrowData?.events || []).map(e => extractGameData(e, config));

    // Pre-game = not yet started
    const preGamesToday    = todayGames.filter(g => g.state === 'pre');
    const liveGamesToday   = todayGames.filter(g => g.state === 'in');
    const preGamesTomorrow = tomorrowGames.filter(g => g.state === 'pre');

    // Combine: show today's pre-game first, then live (can still preview),
    // then tomorrow's if today has nothing
    let games = [...preGamesToday];
    if (games.length === 0) games = [...liveGamesToday, ...preGamesTomorrow.slice(0, 3)];

    console.log(`[pregame/scan] Found ${games.length} games (${preGamesToday.length} pre-game today)`);

    return res.status(200).json({
      success:     true,
      games,
      total:       games.length,
      today_count: todayGames.length,
      scanned_at:  new Date().toISOString(),
      sport:       config.label,
    });

  } catch (err) {
    console.error('[pregame/scan] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}
