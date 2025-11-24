// FILE LOCATION: api/espn/get-games.js
export default async function handler(req, res) {
  const { sport } = req.query;

  try {
    if (!sport) {
      return res.status(400).json({ error: 'Sport parameter required' });
    }

    const games = await fetchGamesFromESPN(sport);

    res.status(200).json({
      success: true,
      sport,
      games,
      source: 'espn'
    });
  } catch (error) {
    console.error('Error fetching from ESPN:', error);
    // Fallback to mock data if ESPN API fails
    res.status(200).json({
      success: true,
      sport,
      games: getMockGames(sport),
      source: 'mock_fallback',
      error: error.message
    });
  }
}

async function fetchGamesFromESPN(sport) {
  try {
    // Map sport names to ESPN league codes
    const leagueMap = {
      NFL: 'nfl',
      NBA: 'nba',
      NHL: 'nhl',
      CollegeBasketball: 'college-basketball'
    };

    const league = leagueMap[sport];
    if (!league) throw new Error('Invalid sport');

    // Fetch today's games
    const url = `https://site.api.espn.com/v2/site/sports/${league}/today`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`ESPN API returned ${response.status}`);
    
    const data = await response.json();

    if (!data.events || data.events.length === 0) {
      console.log(`No games found for ${sport}, using mock data`);
      return getMockGames(sport);
    }

    // Transform ESPN data
    const games = data.events.map(event => ({
      id: event.id,
      name: `${event.competitors[1].team.displayName} at ${event.competitors[0].team.displayName}`,
      homeTeam: event.competitors[0].team.displayName,
      awayTeam: event.competitors[1].team.displayName,
      startTime: event.date,
      status: event.status.type.name,
      league: league
    }));

    return games;
  } catch (error) {
    console.error('ESPN fetch error:', error);
    throw error;
  }
}

function getMockGames(sport) {
  const mockGames = {
    NFL: [
      { id: 'nfl-1', name: 'KC Chiefs at JAX Jaguars', homeTeam: 'Jacksonville Jaguars', awayTeam: 'Kansas City Chiefs', startTime: new Date().toISOString(), status: 'scheduled', league: 'nfl' },
      { id: 'nfl-2', name: 'LAR Rams at SF 49ers', homeTeam: 'San Francisco 49ers', awayTeam: 'Los Angeles Rams', startTime: new Date().toISOString(), status: 'scheduled', league: 'nfl' }
    ],
    NBA: [
      { id: 'nba-1', name: 'Boston Celtics at LA Lakers', homeTeam: 'Los Angeles Lakers', awayTeam: 'Boston Celtics', startTime: new Date().toISOString(), status: 'scheduled', league: 'nba' },
      { id: 'nba-2', name: 'Denver Nuggets at Golden State Warriors', homeTeam: 'Golden State Warriors', awayTeam: 'Denver Nuggets', startTime: new Date().toISOString(), status: 'scheduled', league: 'nba' }
    ],
    NHL: [
      { id: 'nhl-1', name: 'Boston Bruins at NY Rangers', homeTeam: 'New York Rangers', awayTeam: 'Boston Bruins', startTime: new Date().toISOString(), status: 'scheduled', league: 'nhl' },
      { id: 'nhl-2', name: 'Montreal Canadiens at Toronto Maple Leafs', homeTeam: 'Toronto Maple Leafs', awayTeam: 'Montreal Canadiens', startTime: new Date().toISOString(), status: 'scheduled', league: 'nhl' }
    ],
    CollegeBasketball: [
      { id: 'cbb-1', name: 'North Carolina at Duke', homeTeam: 'Duke', awayTeam: 'North Carolina', startTime: new Date().toISOString(), status: 'scheduled', league: 'college-basketball' },
      { id: 'cbb-2', name: 'Texas at Kansas', homeTeam: 'Kansas', awayTeam: 'Texas', startTime: new Date().toISOString(), status: 'scheduled', league: 'college-basketball' }
    ]
  };

  return mockGames[sport] || [];
}
