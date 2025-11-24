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

    if (data.events && Array.isArray(data.events)) {
      data.events.forEach(event => {
        const status = event.status?.type || 'SCHEDULED';
        
        // Only include scheduled or in-progress games (not final yet)
        if (status !== 'FINAL' && status !== 'COMPLETED') {
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
              eventId: event.id
            });
          }
        }
      });
    }

    console.log(`✅ Found ${games.length} games from ESPN`);
    return games.length > 0 ? games : getMockGames(sport);

  } catch (error) {
    console.error('❌ ESPN API error:', error);
    return getMockGames(sport);
  }
}

function mapStatus(status) {
  const statusMap = {
    'SCHEDULED': 'scheduled',
    'IN_PROGRESS': 'in_progress',
    'LIVE': 'in_progress',
    'HALFTIME': 'halftime',
    'FINAL': 'final',
    'COMPLETED': 'final',
    'COMPLETED_OT': 'final'
  };
  return statusMap[status] || 'scheduled';
}

function getMockGames(sport) {
  const gamesMap = {
    NFL: [
      { id: 'nfl-1', name: 'Kansas City Chiefs at Jacksonville Jaguars', homeTeam: 'Jacksonville Jaguars', awayTeam: 'Kansas City Chiefs', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nfl-1' },
      { id: 'nfl-2', name: 'Los Angeles Rams at San Francisco 49ers', homeTeam: 'San Francisco 49ers', awayTeam: 'Los Angeles Rams', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nfl-2' }
    ],
    NBA: [
      { id: 'nba-1', name: 'Boston Celtics at Los Angeles Lakers', homeTeam: 'Los Angeles Lakers', awayTeam: 'Boston Celtics', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nba-1' },
      { id: 'nba-2', name: 'Denver Nuggets at Golden State Warriors', homeTeam: 'Golden State Warriors', awayTeam: 'Denver Nuggets', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nba-2' }
    ],
    NHL: [
      { id: 'nhl-1', name: 'Boston Bruins at New York Rangers', homeTeam: 'New York Rangers', awayTeam: 'Boston Bruins', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nhl-1' },
      { id: 'nhl-2', name: 'Montreal Canadiens at Toronto Maple Leafs', homeTeam: 'Toronto Maple Leafs', awayTeam: 'Montreal Canadiens', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'nhl-2' }
    ],
    CollegeBasketball: [
      { id: 'cbb-1', name: 'North Carolina at Duke', homeTeam: 'Duke', awayTeam: 'North Carolina', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'cbb-1' },
      { id: 'cbb-2', name: 'Texas at Kansas', homeTeam: 'Kansas', awayTeam: 'Texas', startTime: new Date().toISOString(), status: 'scheduled', eventId: 'cbb-2' }
    ]
  };

  return gamesMap[sport] || [];
}
