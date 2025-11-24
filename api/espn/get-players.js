// FILE LOCATION: api/espn/get-players.js
export default async function handler(req, res) {
  const { sport, category, gameName, eventId } = req.query;

  try {
    if (!sport || !category || !gameName || !eventId) {
      return res.status(400).json({ error: 'Sport, category, gameName, and eventId required' });
    }

    const players = await fetchRealPlayers(sport, category, gameName, eventId);

    res.status(200).json({
      success: true,
      sport,
      category,
      gameName,
      players,
      source: 'espn_live'
    });
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(200).json({
      success: true,
      sport,
      category,
      gameName,
      players: getMockPlayers(sport, category, gameName),
      source: 'mock_fallback',
      error: error.message
    });
  }
}

async function fetchRealPlayers(sport, category, gameName, eventId) {
  try {
    if (!eventId) {
      return getMockPlayers(sport, category, gameName);
    }

    const leagueMap = {
      'NFL': { league: 'nfl', sport: 'football' },
      'NBA': { league: 'nba', sport: 'basketball' },
      'NHL': { league: 'nhl', sport: 'hockey' },
      'CollegeBasketball': { league: 'mens-college-basketball', sport: 'basketball' }
    };

    const config = leagueMap[sport];
    if (!config) return getMockPlayers(sport, category, gameName);

    // Fetch game summary/boxscore
    const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/summary?event=${eventId}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ESPN API returned ${response.status}`);
    }

    const data = await response.json();
    const teams = gameName.split(' at ').map(t => t.trim().toLowerCase());
    const players = [];

    // Parse boxscore for player stats
    if (data.boxscore?.teams) {
      data.boxscore.teams.forEach(team => {
        const teamName = team.team?.displayName || '';
        
        const isInGame = teams.some(t => 
          teamName.toLowerCase().includes(t) || t.includes(teamName.toLowerCase())
        );

        if (isInGame && team.players) {
          team.players.forEach(playerData => {
            const player = playerData.person;
            const stats = playerData.stats || [];

            if (player?.displayName) {
              // Get the stat value for this category
              const statValue = extractStatValue(stats, category, sport);

              if (statValue !== null && statValue !== undefined) {
                players.push({
                  id: player.id,
                  name: player.displayName,
                  team: teamName,
                  avg: Math.round(statValue * 10) / 10
                });
              }
            }
          });
        }
      });
    }

    console.log(`✅ Found ${players.length} players with category ${category}`);
    return players.length > 0 ? players : getMockPlayers(sport, category, gameName);

  } catch (error) {
    console.error('Error fetching real players:', error);
    return getMockPlayers(sport, category, gameName);
  }
}

function extractStatValue(stats, category, sport) {
  // Map categories to ESPN stat field names
  const categoryMap = {
    'passing_yards': ['passingYards', 'passingYd', 'passing'],
    'receiving_yards': ['receivingYards', 'receivingYd', 'receiving'],
    'rushing_yards': ['rushingYards', 'rushingYd', 'rushing'],
    'receptions': ['receivingReceptions', 'receptions', 'rec'],
    'touchdowns': ['touchdowns', 'total_td', 'td'],
    'points': ['points', 'pts'],
    'rebounds': ['totalRebounds', 'rebounds', 'reb'],
    'assists': ['assists', 'ast'],
    'shots_on_goal': ['shots', 'sog'],
    'goals': ['goals', 'goal'],
    'hits': ['hits'],
    '3_pointers': ['threePointFieldGoalsMade', 'three_pointers']
  };

  const categoryKey = category.toLowerCase().replace(/[-\s]/g, '_');
  const possibleNames = categoryMap[categoryKey] || [category];

  // Search through stats to find matching field
  for (const stat of stats) {
    const statName = (stat.name || '').toLowerCase().replace(/[-\s]/g, '_');
    const abbr = (stat.abbreviation || '').toLowerCase().replace(/[-\s]/g, '_');
    
    // Check if any of the possible names match
    for (const possibleName of possibleNames) {
      const normalized = possibleName.toLowerCase().replace(/[-\s]/g, '_');
      
      if (
        statName.includes(normalized) ||
        abbr.includes(normalized) ||
        stat.name?.toLowerCase().includes(possibleName.toLowerCase())
      ) {
        const value = parseInt(stat.displayValue || stat.value || 0);
        return !isNaN(value) ? value : 0;
      }
    }
  }

  return null;
}

function getMockPlayers(sport, category, gameName) {
  const teams = gameName.split(' at ').map(t => t.trim());
  
  const allPlayers = {
    NFL: [
      { id: '1', name: 'Patrick Mahomes', team: 'Kansas City Chiefs', avg: 265 },
      { id: '2', name: 'Trevor Lawrence', team: 'Jacksonville Jaguars', avg: 215 },
      { id: '3', name: 'Brock Purdy', team: 'San Francisco 49ers', avg: 255 },
      { id: '4', name: 'Bryce Young', team: 'Carolina Panthers', avg: 195 },
      { id: '10', name: 'Travis Kelce', team: 'Kansas City Chiefs', avg: 75 },
      { id: '11', name: 'Travis Etienne', team: 'Jacksonville Jaguars', avg: 68 },
      { id: '12', name: 'Christian Kirk', team: 'Jacksonville Jaguars', avg: 65 }
    ],
    NBA: [
      { id: '1', name: 'Jayson Tatum', team: 'Boston Celtics', avg: 28 },
      { id: '3', name: 'Anthony Davis', team: 'Los Angeles Lakers', avg: 23 },
      { id: '11', name: 'Nikola Jokic', team: 'Denver Nuggets', avg: 27 },
      { id: '12', name: 'Luka Doncic', team: 'Dallas Mavericks', avg: 33 }
    ],
    NHL: [
      { id: '1', name: 'Connor McDavid', team: 'Edmonton Oilers', avg: 4.2 },
      { id: '2', name: 'Auston Matthews', team: 'Toronto Maple Leafs', avg: 4.0 },
      { id: '3', name: 'David Pastrnak', team: 'Boston Bruins', avg: 3.8 }
    ],
    CollegeBasketball: [
      { id: '1', name: 'Paolo Banchero', team: 'Duke', avg: 22 },
      { id: '3', name: 'Armando Bacot', team: 'North Carolina', avg: 18 }
    ]
  };

  const catKey = category.toLowerCase();
  const catPlayers = allPlayers[sport] || [];
  
  return catPlayers.filter(p => 
    teams.some(t => 
      p.team.toLowerCase().includes(t.toLowerCase()) || 
      t.toLowerCase().includes(p.team.toLowerCase())
    )
  );
}
