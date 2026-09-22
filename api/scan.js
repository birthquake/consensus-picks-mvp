// FILE LOCATION: api/scan.js
// Combined pregame + live game scanner (merged from api/pregame/scan.js and
// api/halftime/scan.js to save a Vercel function slot — Hobby plan caps at 12).
// Dispatches on the query shape each mode already used before the merge:
//   ?sport=X        (singular) -> pregame mode: today/tomorrow window (NFL: current week)
//   ?sports=X,Y,Z    (plural)  -> live mode: games currently in progress

const SPORT_CONFIG = {
  nba: { sport: 'basketball', league: 'nba', label: 'NBA' },
  mlb: { sport: 'baseball',   league: 'mlb', label: 'MLB' },
  nhl: { sport: 'hockey',     league: 'nhl', label: 'NHL' },
  nfl: { sport: 'football',   league: 'nfl', label: 'NFL' },
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

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

// ─── Pregame mode ───────────────────────────────────────────────────────────

function extractPregameData(event, config) {
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

async function handlePregame(req, res) {
  const sportKey = (req.query.sport || 'nba').toLowerCase();
  const config   = SPORT_CONFIG[sportKey];

  if (!config) {
    return res.status(400).json({ error: `Unsupported sport: ${sportKey}` });
  }

  // NFL plays weekly, not daily — use ESPN's current-week scoreboard instead of
  // the today/tomorrow window the other sports use.
  if (sportKey === 'nfl') {
    try {
      const thisWeekData = await fetchWithTimeout(
        `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard`
      );

      const weekNumber  = thisWeekData?.week?.number ?? null;
      const weekEvents  = (thisWeekData?.events || []).map(e => extractPregameData(e, config));
      const preThisWeek = weekEvents.filter(g => g.state === 'pre');
      const liveThisWeek = weekEvents.filter(g => g.state === 'in');

      let games = [];
      let context = '';

      if (preThisWeek.length > 0) {
        games = preThisWeek;
        context = `pre-game week ${weekNumber ?? '?'}`;
      } else if (liveThisWeek.length > 0) {
        games = liveThisWeek;
        context = `live week ${weekNumber ?? '?'}`;
      } else if (weekNumber != null) {
        const nextWeekData = await fetchWithTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard?week=${weekNumber + 1}&seasontype=2`
        );
        const nextWeekEvents = (nextWeekData?.events || []).map(e => extractPregameData(e, config));
        games = nextWeekEvents.filter(g => g.state === 'pre');
        context = `pre-game week ${weekNumber + 1}`;
      }

      console.log(`[scan] NFL: found ${games.length} games (context: ${context})`);

      return res.status(200).json({
        success:     true,
        games,
        total:       games.length,
        context,
        today_count: weekEvents.length,
        scanned_at:  new Date().toISOString(),
        sport:       config.label,
        oddsMap:     {},
        odds_players: 0,
      });
    } catch (err) {
      console.error('[scan] NFL error:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  try {
    // Fetch today's scoreboard using UTC dates to match ESPN API expectations
    // ESPN's API expects dates in YYYYMMDD format in UTC, not local timezone
    // This fixes an issue where the server's local timezone could cause
    // the scanner to return tomorrow's games when it should return today's
    // Use Eastern Time for date — NBA/MLB/NHL schedules are ET-based
    // Vercel servers run UTC so we subtract 4 hours (EDT) to get the correct ET date
    const nowET    = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const today    = formatDate(nowET);
    const tomorrow = formatDate(new Date(nowET.getTime() + 86400000));

    const [todayData, tomorrowData] = await Promise.all([
      fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard?dates=${today}`),
      fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard?dates=${tomorrow}`),
    ]);

    // Odds fetching disabled — using calculated thresholds instead
    const todayGames    = (todayData?.events    || []).map(e => extractPregameData(e, config));
    const tomorrowGames = (tomorrowData?.events || []).map(e => extractPregameData(e, config));

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

    console.log(`[scan] Found ${games.length} games (context: ${context})`);

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
    console.error('[scan] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Live mode ────────────────────────────────────────────────────────────

function isLive(event) {
  const state = event.competitions?.[0]?.status?.type?.state;
  return state === 'in';
}

function extractLiveGameData(event, config) {
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
  } else if (config.league === 'nfl') {
    if (description.toLowerCase().includes('halftime')) phaseLabel = 'Halftime';
    else if (period > 4) phaseLabel = 'OT';
    else if (period) phaseLabel = `Q${period}`;
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

async function handleLive(req, res) {
  const requestedSports = (req.query.sports || 'nba,nhl').split(',').map(s => s.trim().toLowerCase());

  try {
    const scoreboard_fetches = requestedSports.map(async (sportKey) => {
      const config = SPORT_CONFIG[sportKey];
      if (!config) return [];

      const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard`;
      const data = await fetchWithTimeout(url);
      if (!data?.events) return [];

      const liveGames = data.events.filter(e => isLive(e));
      return liveGames.map(e => extractLiveGameData(e, config));
    });

    const results = await Promise.all(scoreboard_fetches);
    const games = results.flat();

    console.log(`[scan] Found ${games.length} live games across ${requestedSports.join(', ')}`);

    return res.status(200).json({
      success: true,
      games,
      total: games.length,
      scanned_at: new Date().toISOString(),
      sports_scanned: requestedSports,
    });

  } catch (err) {
    console.error('[scan] Live error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.query.sports != null) {
    return handleLive(req, res);
  }
  return handlePregame(req, res);
}
