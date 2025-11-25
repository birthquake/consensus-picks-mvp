// FILE LOCATION: api/espn/get-games.js
// UPDATED TO USE API-SPORTS ONLY (replaces ESPN)

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
      source: 'api_sports'
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
  // API-Sports league mapping
  const leagueMap = {
    'NFL': { baseUrl: 'https://v1.american-football.api-sports.io', leagueId: 1 },
    'NBA': { baseUrl: 'https://v1.basketball.api-sports.io', leagueId: 1 },
    'NHL': { baseUrl: 'https://v1.hockey.api-sports.io', leagueId: 1 },
    'CollegeBasketball': { baseUrl: 'https://v1.basketball.api-sports.io', leagueId: 2 }
  };

  const config = leagueMap[sport];
  if (!config) return getMockGames(sport);

  const apiKey = process.env.API_SPORTS_KEY;
  if (!apiKey) {
    console.error('❌ API_SPORTS_KEY not found in environment variables');
    return getMockGames(sport);
  }

  try {
    const games = [];
    const now = new Date();
    
    // Determine how many days to check
    const daysToCheck = sport === 'NFL' ? 7 : 2; // NFL is sparse, other sports have daily games

    // Check each day
    for (let i = 0; i < daysToCheck; i++) {
      const checkDate = new Date(now);
      checkDate.setDate(checkDate.getDate() + i);
      const dateStr = checkDate.toISOString().split('T')[0]; // YYYY-MM-DD format

      const url = `${config.baseUrl}/games?date=${dateStr}`;
      console.log(`📡 Fetching ${sport} games from API-Sports for ${dateStr}`);

      const response = await fetch(url, {
        headers: {
          'x-rapidapi-key': apiKey
        }
      });

      if (!response.ok) {
        console.error(`API-Sports returned ${response.status}`);
        continue;
      }

      const data = await response.json();

      // Parse API-Sports response
      if (data.response && Array.isArray(data.response)) {
        data.response.forEach(item => {
          // Note: API-Sports wraps game data in nested structure
          const gameData = item.game;
          const teamData = item.teams;
          
          // Only include finished games or upcoming games (not in progress for now)
          const status = gameData.status.short;
          if (status === 'FT' || status === 'AOT' || status === 'NS' || status === 'Q1' || status === 'Q2' || status === 'Q3' || status === 'Q4' || status === 'HT' || status === 'OT') {
            const homeTeam = teamData.home.name;
            const awayTeam = teamData.away.name;
            
            // Create proper date from nested date object
            const dateTimeStr = `${gameData.date.date}T${gameData.date.time}:00Z`;
            const gameTime = new Date(dateTimeStr);

            games.push({
              id: gameData.id,
              name: `${awayTeam} at ${homeTeam}`,
              homeTeam,
              awayTeam,
              startTime: dateTimeStr,
              status: mapApiSportsStatus(status),
              eventId: gameData.id,
              gameTime,
              apiSportsId: gameData.id // Important: store this for get-players.js to use
            });
          }
        });
      }
    }

    // Sort by game time
    games.sort((a, b) => a.gameTime - b.gameTime);

    console.log(`✅ Found ${games.length} active games from API-Sports`);
    return games.length > 0 ? games : getMockGames(sport);

  } catch (error) {
    console.error('❌ API-Sports error:', error);
    return getMockGames(sport);
  }
}

function mapApiSportsStatus(status) {
  // API-Sports status codes: NS, Q1-Q4, OT, HT, FT, AOT, CANC, PST
  const statusMap = {
    'NS': 'scheduled',    // Not Started
    'Q1': 'in_progress',
    'Q2': 'in_progress',
    'Q3': 'in_progress',
    'Q4': 'in_progress',
    'OT': 'in_progress',  // Overtime
    'HT': 'halftime',
    'FT': 'final',        // Full Time
    'AOT': 'final',       // After Overtime
    'CANC': 'cancelled',
    'PST': 'postponed'
  };
  return statusMap[status] || 'scheduled';
}

function getMockGames(sport) {
  const gamesMap = {
    NFL: [
      { id: 'nfl-1', name: 'Kansas City Chiefs at Jacksonville Jaguars', homeTeam: 'Jacksonville Jaguars', awayTeam: 'Kansas City Chiefs', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nfl-1', apiSportsId: 'nfl-1' }
    ],
    NBA: [
      { id: 'nba-1', name: 'Boston Celtics at Los Angeles Lakers', homeTeam: 'Los Angeles Lakers', awayTeam: 'Boston Celtics', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nba-1', apiSportsId: 'nba-1' }
    ],
    NHL: [
      { id: 'nhl-1', name: 'Boston Bruins at New York Rangers', homeTeam: 'New York Rangers', awayTeam: 'Boston Bruins', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nhl-1', apiSportsId: 'nhl-1' }
    ],
    CollegeBasketball: [
      { id: 'cbb-1', name: 'North Carolina at Duke', homeTeam: 'Duke', awayTeam: 'North Carolina', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'cbb-1', apiSportsId: 'cbb-1' }
    ]
  };

  return gamesMap[sport] || [];
}
