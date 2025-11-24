// FILE LOCATION: api/espn/get-players.js
export default async function handler(req, res) {
  const { sport, category, gameName, eventId } = req.query;

  try {
    if (!sport || !category || !gameName || !eventId) {
      return res.status(400).json({ error: 'Sport, category, gameName, and eventId required' });
    }

    console.log('🔵 [GET-PLAYERS] Fetching players for:', { sport, category, gameName, eventId });

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
    console.error('❌ [GET-PLAYERS] Error:', error);
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
    const leagueMap = {
      'NFL': { league: 'nfl', sport: 'football' },
      'NBA': { league: 'nba', sport: 'basketball' },
      'NHL': { league: 'nhl', sport: 'hockey' },
      'CollegeBasketball': { league: 'mens-college-basketball', sport: 'basketball' }
    };

    const config = leagueMap[sport];
    if (!config) return getMockPlayers(sport, category, gameName);

    // Step 1: Get game details to identify teams
    const gameTeams = await getGameTeams(config, eventId);
    if (!gameTeams || gameTeams.length === 0) {
      console.log('⚠️ Could not fetch game teams, using mock data');
      return getMockPlayers(sport, category, gameName);
    }

    console.log('✅ Found teams:', gameTeams);

    // Step 2: Get all player stats for this sport/league
    const allPlayers = await getAllPlayerStats(config, sport);
    if (!allPlayers || allPlayers.length === 0) {
      console.log('⚠️ No players found, using mock data');
      return getMockPlayers(sport, category, gameName);
    }

    // Step 3: Filter players by game teams and category
    const filteredPlayers = allPlayers.filter(p => 
      gameTeams.some(t => 
        p.team.toLowerCase().includes(t.toLowerCase()) || 
        t.toLowerCase().includes(p.team.toLowerCase())
      )
    );

    console.log(`✅ Found ${filteredPlayers.length} players in this game`);
    return filteredPlayers.length > 0 ? filteredPlayers : getMockPlayers(sport, category, gameName);

  } catch (error) {
    console.error('❌ [FETCH-REAL] Error:', error);
    return getMockPlayers(sport, category, gameName);
  }
}

async function getGameTeams(config, eventId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/summary?event=${eventId}`;
    console.log(`📡 Fetching game teams from: ${url}`);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Status ${response.status}`);

    const data = await response.json();
    const competitors = data.competitions?.[0]?.competitors || [];

    if (competitors.length === 0) return null;

    return competitors.map(c => c.team?.displayName).filter(Boolean);
  } catch (error) {
    console.error('❌ [GET-TEAMS] Error:', error);
    return null;
  }
}

async function getAllPlayerStats(config, sport) {
  try {
    // Use the statistics/players endpoint which gives aggregate stats
    const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/statistics/players`;
    console.log(`📡 Fetching player stats from: ${url}`);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Status ${response.status}`);

    const data = await response.json();

    if (!Array.isArray(data)) {
      console.log('⚠️ Response is not an array, trying to parse as object');
      return parsePlayersFromObject(data, sport);
    }

    return data.map(p => ({
      id: p.id,
      name: p.displayName || p.name,
      team: p.team?.displayName || p.team,
      avg: getStatAverage(p, sport)
    })).filter(p => p.name && p.team);

  } catch (error) {
    console.error('❌ [GET-ALL-PLAYERS] Error:', error);
    return null;
  }
}

function parsePlayersFromObject(data, sport) {
  // Sometimes ESPN returns an object instead of array
  const players = [];

  if (data.statistics && Array.isArray(data.statistics)) {
    data.statistics.forEach(stat => {
      if (stat.displayName && stat.team) {
        players.push({
          id: stat.id || Math.random(),
          name: stat.displayName,
          team: stat.team.displayName || stat.team,
          avg: stat.value || 0
        });
      }
    });
  }

  return players.length > 0 ? players : null;
}

function getStatAverage(player, sport) {
  // Different sports have different stat structures
  // This extracts the most relevant stat for the player
  if (player.stats && typeof player.stats === 'object') {
    return Object.values(player.stats)[0] || 0;
  }
  return player.value || player.avg || 0;
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
