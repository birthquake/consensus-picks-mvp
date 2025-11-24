// FILE LOCATION: api/espn/get-players.js
export default async function handler(req, res) {
  const { sport, category, gameName, eventId } = req.query;

  try {
    if (!sport || !category || !gameName) {
      return res.status(400).json({ error: 'Sport, category, and gameName required' });
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

    const url = `https://site.web.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/summary?region=us&lang=en&contentorigin=espn&event=${eventId}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ESPN API returned ${response.status}`);
    }

    const data = await response.json();
    const teams = gameName.split(' at ').map(t => t.trim().toLowerCase());
    const players = [];

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
              const statValue = extractStatValue(stats, category, sport);

              if (statValue !== null) {
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

    return players.length > 0 ? players : getMockPlayers(sport, category, gameName);

  } catch (error) {
    console.error('Error fetching real players:', error);
    return getMockPlayers(sport, category, gameName);
  }
}

function extractStatValue(stats, category, sport) {
  const categoryMap = {
    'Passing Yards': 'passingYards',
    'Receiving Yards': 'receivingYards',
    'Rushing Yards': 'rushingYards',
    'Receptions': 'receivingReceptions',
    'Touchdowns': 'touchdowns',
    'Points': 'points',
    'Rebounds': 'totalRebounds',
    'Assists': 'assists',
    'Shots on Goal': 'shots',
    'Goals': 'goals',
    'Hits': 'hits',
    '3-Pointers': 'threePointFieldGoalsMade'
  };

  const statName = categoryMap[category];
  if (!statName) return null;

  for (const stat of stats) {
    if (stat.name === statName || stat.abbreviation === statName) {
      return parseInt(stat.displayValue || stat.value || 0);
    }
  }

  return null;
}

function getMockPlayers(sport, category, gameName) {
  const teams = gameName.split(' at ').map(t => t.trim());
  
  const allPlayers = {
    NFL: {
      'passing_yards': [
        { id: '1', name: 'Patrick Mahomes', team: 'Kansas City Chiefs', avg: 265 },
        { id: '2', name: 'Trevor Lawrence', team: 'Jacksonville Jaguars', avg: 215 },
        { id: '3', name: 'Brock Purdy', team: 'San Francisco 49ers', avg: 255 },
        { id: '4', name: 'Bryce Young', team: 'Carolina Panthers', avg: 195 }
      ],
      'receiving_yards': [
        { id: '10', name: 'Travis Kelce', team: 'Kansas City Chiefs', avg: 75 },
        { id: '12', name: 'Christian Kirk', team: 'Jacksonville Jaguars', avg: 65 }
      ]
    },
    NBA: {
      'points': [
        { id: '1', name: 'Jayson Tatum', team: 'Boston Celtics', avg: 28 },
        { id: '3', name: 'Anthony Davis', team: 'Los Angeles Lakers', avg: 23 }
      ]
    }
  };

  const catKey = category.toLowerCase();
  const catPlayers = allPlayers[sport]?.[catKey] || [];
  
  return catPlayers.filter(p => 
    teams.some(t => p.team.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(p.team.toLowerCase()))
  );
}
