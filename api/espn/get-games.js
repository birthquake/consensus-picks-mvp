// FILE LOCATION: api/espn/get-games.js
export default async function handler(req, res) {
  const { sport } = req.query;

  try {
    if (!sport) {
      return res.status(400).json({ error: 'Sport parameter required' });
    }

    const games = await fetchRealGames(sport);

    res.status(200).json({
      success: true,
      sport,
      games,
      source: 'espn_live'
    });
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(200).json({
      success: true,
      sport,
      games: getMockGames(sport),
      source: 'mock_fallback',
      error: error.message
    });
  }
}

async function fetchRealGames(sport) {
  const leagueMap = {
    'NFL': { league: 'nfl', sport: 'football' },
    'NBA': { league: 'nba', sport: 'basketball' },
    'NHL': { league: 'nhl', sport: 'hockey' },
    'CollegeBasketball': { league: 'mens-college-basketball', sport: 'basketball' }
  };

  const config = leagueMap[sport];
  if (!config) return getMockGames(sport);

  try {
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard?region=us&lang=en`;
    console.log(`📡 Fetching ESPN games from: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ESPN API returned ${response.status}`);
    }

    const data = await response.json();
    const games = [];
    const now = new Date();
    
    // Dynamic time windows based on sport
    const timeWindowDays = getTimeWindow(sport);
    const windowEnd = new Date(now.getTime() + timeWindowDays * 24 * 60 * 60 * 1000);

    if (data.events && Array.isArray(data.events)) {
      data.events.forEach(event => {
        const status = event.status?.type || 'SCHEDULED';
        const gameTime = new Date(event.date);
        
        const isCompleted = status === 'FINAL' || status === 'COMPLETED' || status === 'COMPLETED_OT';
        const isWithinWindow = gameTime >= now && gameTime <= windowEnd;
        const isLive = status === 'IN_PROGRESS' || status === 'LIVE' || status === 'HALFTIME' || status === 'END_PERIOD';
        
        if (!isCompleted && (isWithinWindow || isLive)) {
          const competitors = event.competitions?.[0]?.competitors || [];
          
          if (competitors.length >= 2) {
            const homeTeam = competitors.find(c => c.homeAway === 'home')?.team?.displayName || 'Team A';
            const awayTeam = competitors.find(c => c.homeAway === 'away')?.team?.displayName || 'Team B';
            
            games.push({
              id: event.id,
              name: `${awayTeam} at ${homeTeam}`,
              homeTeam,
              awayTeam,
              startTime: event.date,
              status: mapStatus(status),
              eventId: event.id,
              gameTime: gameTime
            });
          }
        }
      });
    }

    // Sort by game time
    games.sort((a, b) => a.gameTime - b.gameTime);

    console.log(`✅ Found ${games.length} active games from ESPN (${timeWindowDays}-day window)`);
    return games.length > 0 ? games : getMockGames(sport);

  } catch (error) {
    console.error('❌ ESPN API error:', error);
    return getMockGames(sport);
  }
}

function getTimeWindow(sport) {
  // NFL has sparse games - show 7 days
  // NBA, NHL, CBB have games almost every night - show 2 days
  const windowMap = {
    'NFL': 7,
    'NBA': 2,
    'NHL': 2,
    'CollegeBasketball': 2
  };
  return windowMap[sport] || 2;
}

function mapStatus(status) {
  const statusMap = {
    'SCHEDULED': 'scheduled',
    'IN_PROGRESS': 'in_progress',
    'LIVE': 'in_progress',
    'HALFTIME': 'halftime',
    'END_PERIOD': 'in_progress',
    'FINAL': 'final',
    'COMPLETED': 'final',
    'COMPLETED_OT': 'final'
  };
  return statusMap[status] || 'scheduled';
}

function getMockGames(sport) {
  const gamesMap = {
    NFL: [
      { id: 'nfl-1', name: 'Kansas City Chiefs at Jacksonville Jaguars', homeTeam: 'Jacksonville Jaguars', awayTeam: 'Kansas City Chiefs', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nfl-1' }
    ],
    NBA: [
      { id: 'nba-1', name: 'Boston Celtics at Los Angeles Lakers', homeTeam: 'Los Angeles Lakers', awayTeam: 'Boston Celtics', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nba-1' }
    ],
    NHL: [
      { id: 'nhl-1', name: 'Boston Bruins at New York Rangers', homeTeam: 'New York Rangers', awayTeam: 'Boston Bruins', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nhl-1' }
    ],
    CollegeBasketball: [
      { id: 'cbb-1', name: 'North Carolina at Duke', homeTeam: 'Duke', awayTeam: 'North Carolina', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'cbb-1' }
    ]
  };

  return gamesMap[sport] || [];
}
