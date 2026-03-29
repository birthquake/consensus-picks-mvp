// FILE LOCATION: api/pregame/scan.js
// Returns today's scheduled and upcoming NBA games.
// Unlike halftime/scan which filters for live halftime games,
// this returns games that haven't started yet (state === 'pre')
// plus any games in the next 24 hours.
//
// Usage: GET /api/pregame/scan?sport=nba

// import { fetchNBAPlayerProps } from '../../lib/odds-client.js'; // DISABLED — conserve API credits

const SPORT_CONFIG = {
  nba: { sport: 'basketball', league: 'nba', label: 'NBA' },
  mlb: { sport: 'baseball',   league: 'mlb', label: 'MLB' },
  nhl: { sport: 'hockey',     league: 'nhl', label: 'NHL' },
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

function extractGameData(event, config, targetDate = null) {
  const comp        = event.competitions?.[0];
  const status      = comp?.status;
  const competitors = comp?.competitors || [];
  const home        = competitors.find(c => c.homeAway === 'home');
  const away        = competitors.find(c => c.homeAway === 'away');
  const gameDate    = comp?.date ? comp.date.substring(0, 10) : null;

  return {
    id:        event.id,
    sport:     config.sport,
    league:    config.league,
    label:     config.label,
    name:      event.name,
    shortName: event.shortName,
    gameDate:  comp?.date || event.date,
    gameDateStr: gameDate, // YYYY-MM-DD for filtering
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

    // Odds fetching disabled — using calculated thresholds instead
    const oddsMap = {};

    const todayGames    = (todayData?.events    || []).map(e => extractGameData(e, config));
    const tomorrowGames = (tomorrowData?.events || []).map(e => extractGameData(e, config));

    // Trust ESPN's scoreboard response — it returns the correct games for the date passed
    // Don't filter by UTC date string (causes issues for evening ET games that are next day UTC)
    const preGamesToday    = todayGames.filter(g => g.state === 'pre');
    const liveGamesToday   = todayGames.filter(g => g.state === 'in');
    const finishedToday    = todayGames.filter(g => g.state === 'post');
    const preGamesTomorrow = tomorrowGames.filter(g => g.state === 'pre');

    // Priority: pre-game today → live today → tomorrow's pre-games
    // Never mix days — show one clear context at a time
    let games = [];
    let context = '';

    if (preGamesToday.length > 0) {
      games = preGamesToday;
      context = 'pre-game today';
    } else if (liveGamesToday.length > 0) {
      // Games in progress — still useful for analysis
      games = liveGamesToday;
      context = 'live today';
    } else if (preGamesTomorrow.length > 0) {
      games = preGamesTomorrow;
      context = 'pre-game tomorrow';
    } else if (finishedToday.length > 0) {
      // All done for tonight — show tomorrow
      games = preGamesTomorrow;
      context = 'pre-game tomorrow (all finished today)';
    }

    console.log(`[pregame/scan] Found ${games.length} games (context: ${context})`);
    console.log(`[pregame/scan] Odds disabled — using calculated thresholds`);

    return res.status(200).json({
      success:     true,
      games,
      total:        games.length,
      context,
      today_count:  todayGames.length,
      scanned_at:   new Date().toISOString(),
      sport:        config.label,
      oddsMap:      {},
      odds_players: 0,
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
