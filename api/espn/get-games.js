// FILE LOCATION: api/espn/get-games.js
export default async function handler(req, res) {
  const { sport, date } = req.query;

  try {
    // Map sport names to ESPN league codes
    const sportMap = {
      NFL: 'nfl',
      NBA: 'nba',
      NHL: 'nhl',
      CollegeBasketball: 'college-basketball'
    };

    const league = sportMap[sport];
    if (!league) {
      return res.status(400).json({ error: 'Invalid sport' });
    }

    // Fetch from ESPN
    const gameDate = date || new Date().toISOString().split('T')[0];
    const url = `https://site.api.espn.com/v2/site/sports/${sport.toLowerCase()}/today`;

    const response = await fetch(url);
    const data = await response.json();

    // Transform ESPN data into our format
    const games = [];
    if (data.events) {
      data.events.forEach(event => {
        games.push({
          id: event.id,
          name: `${event.competitors[0].team.name} vs ${event.competitors[1].team.name}`,
          homeTeam: event.competitors[0].team.name,
          awayTeam: event.competitors[1].team.name,
          startTime: event.date,
          status: event.status.type.name
        });
      });
    }

    res.status(200).json({
      success: true,
      sport,
      date: gameDate,
      games
    });
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ 
      error: error.message,
      // Fallback mock data for testing
      fallback: true,
      games: getMockGames(sport)
    });
  }
}

// Fallback mock data
function getMockGames(sport) {
  const mockData = {
    NFL: [
      { id: '1', name: 'KC Chiefs vs JAX Jaguars', homeTeam: 'KC Chiefs', awayTeam: 'JAX Jaguars', startTime: new Date().toISOString(), status: 'scheduled' },
      { id: '2', name: 'LAR Rams vs SF 49ers', homeTeam: 'LAR Rams', awayTeam: 'SF 49ers', startTime: new Date().toISOString(), status: 'scheduled' }
    ],
    NBA: [
      { id: '1', name: 'LA Lakers vs Boston Celtics', homeTeam: 'LA Lakers', awayTeam: 'Boston Celtics', startTime: new Date().toISOString(), status: 'scheduled' },
      { id: '2', name: 'Golden State Warriors vs Denver Nuggets', homeTeam: 'Golden State Warriors', awayTeam: 'Denver Nuggets', startTime: new Date().toISOString(), status: 'scheduled' }
    ],
    NHL: [
      { id: '1', name: 'NYR Rangers vs BOS Bruins', homeTeam: 'NYR Rangers', awayTeam: 'BOS Bruins', startTime: new Date().toISOString(), status: 'scheduled' },
      { id: '2', name: 'TOR Maple Leafs vs MTL Canadiens', homeTeam: 'TOR Maple Leafs', awayTeam: 'MTL Canadiens', startTime: new Date().toISOString(), status: 'scheduled' }
    ],
    CollegeBasketball: [
      { id: '1', name: 'Duke vs North Carolina', homeTeam: 'Duke', awayTeam: 'North Carolina', startTime: new Date().toISOString(), status: 'scheduled' },
      { id: '2', name: 'Kansas vs Texas', homeTeam: 'Kansas', awayTeam: 'Texas', startTime: new Date().toISOString(), status: 'scheduled' }
    ]
  };
  
  return mockData[sport] || [];
}
