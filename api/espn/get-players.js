// FILE LOCATION: api/espn/get-players.js
// NEW APPROACH: Use Athlete Gamelog endpoint instead of boxscore parsing

export default async function handler(req, res) {
  const { sport, category, gameName, eventId } = req.query;

  try {
    if (!sport || !category || !gameName || !eventId) {
      return res.status(400).json({ error: 'Sport, category, gameName, and eventId required' });
    }

    console.log('🔵 [GET-PLAYERS] Fetching players via gamelog:', { sport, category, eventId });

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
    if (!eventId) {
      console.log('⚠️ No eventId provided');
      return getMockPlayers(sport, category, gameName);
    }

    const leagueMap = {
      'NFL': { league: 'nfl', sport: 'football' },
      'NBA': { league: 'nba', sport: 'basketball' },
      'NHL': { league: 'nhl', sport: 'hockey' },
      'CollegeBasketball': { league: 'mens-college-basketball', sport: 'basketball' }
    };

    const config = leagueMap[sport];
    if (!config) {
      console.log('⚠️ Invalid sport:', sport);
      return getMockPlayers(sport, category, gameName);
    }

    // Step 1: Get game info to extract teams and date
    console.log('📡 Step 1: Fetching game info...');
    const gameInfo = await getGameInfo(config, eventId);
    if (!gameInfo || !gameInfo.teams || gameInfo.teams.length === 0) {
      console.log('⚠️ Could not fetch game info');
      return getMockPlayers(sport, category, gameName);
    }

    const gameDate = new Date(gameInfo.date);
    console.log(`✅ Game date: ${gameDate.toISOString()}, Teams: ${gameInfo.teams.join(', ')}`);

    // Step 2: Get rosters for both teams
    console.log('📡 Step 2: Fetching team rosters...');
    const allPlayers = [];
    
    for (const teamId of gameInfo.teamIds) {
      const roster = await getTeamRoster(config, teamId);
      if (roster && roster.length > 0) {
        console.log(`  ✅ Got ${roster.length} players for team ${teamId}`);
        allPlayers.push(...roster);
      }
    }

    if (allPlayers.length === 0) {
      console.log('⚠️ No players found in rosters');
      return getMockPlayers(sport, category, gameName);
    }

    // Step 3: For each player, get their gamelog and find the stat for this game
    console.log(`📡 Step 3: Fetching gamelogs for ${allPlayers.length} players...`);
    const playersWithStats = [];

    for (const player of allPlayers) {
      try {
        const gameStat = await getPlayerGameStat(config, player.id, gameDate, category);
        
        if (gameStat !== null && gameStat !== undefined) {
          playersWithStats.push({
            id: player.id,
            name: player.name,
            team: player.team,
            avg: Math.round(gameStat * 10) / 10
          });
        }
      } catch (err) {
        // Skip individual player errors
        console.log(`  ⚠️ Could not get stat for ${player.name}: ${err.message}`);
      }
    }

    console.log(`✅ Found ${playersWithStats.length} players with stats`);
    return playersWithStats.length > 0 ? playersWithStats : getMockPlayers(sport, category, gameName);

  } catch (error) {
    console.error('❌ [FETCH-REAL] Error:', error);
    return getMockPlayers(sport, category, gameName);
  }
}

async function getGameInfo(config, eventId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/summary?event=${eventId}`;
    console.log(`  📡 Fetching: ${url}`);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Status ${response.status}`);

    const data = await response.json();
    const competitors = data.competitions?.[0]?.competitors || [];

    if (competitors.length < 2) return null;

    const teams = competitors.map(c => c.team?.displayName).filter(Boolean);
    const teamIds = competitors.map(c => c.team?.id).filter(Boolean);
    const date = data.competitions?.[0]?.date;

    return {
      teams,
      teamIds,
      date
    };
  } catch (error) {
    console.error('❌ [GET-GAME-INFO] Error:', error);
    return null;
  }
}

async function getTeamRoster(config, teamId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/teams/${teamId}/roster`;
    console.log(`  📡 Fetching roster for team ${teamId}`);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Status ${response.status}`);

    const data = await response.json();
    const athletes = data.athletes || [];

    return athletes.map(athlete => ({
      id: athlete.id,
      name: athlete.displayName,
      team: data.team?.displayName || ''
    }));
  } catch (error) {
    console.error(`❌ [GET-ROSTER] Error for team ${teamId}:`, error);
    return null;
  }
}

async function getPlayerGameStat(config, athleteId, gameDate, category) {
  try {
    const url = `https://site.web.api.espn.com/apis/common/v3/sports/${config.sport}/${config.league}/athletes/${athleteId}/gamelog`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Status ${response.status}`);

    const data = await response.json();
    const games = data.stats || [];

    if (!Array.isArray(games) || games.length === 0) {
      return null;
    }

    // Find the game matching our date (same day)
    const gameDateStr = gameDate.toISOString().split('T')[0];
    
    for (const game of games) {
      const gameGameDate = new Date(game.date);
      const gameGameDateStr = gameGameDate.toISOString().split('T')[0];

      if (gameGameDateStr === gameDateStr) {
        // Found the matching game, extract the stat
        const statValue = extractStatFromGamelog(game, category);
        return statValue;
      }
    }

    return null;
  } catch (error) {
    console.error(`❌ [GET-GAMELOG] Error for athlete ${athleteId}:`, error);
    return null;
  }
}

function extractStatFromGamelog(game, category) {
  // Map categories to gamelog field names
  const categoryMap = {
    'passing_yards': ['passingYards', 'passing_yds', 'pass_yds'],
    'receiving_yards': ['receivingYards', 'receiving_yds', 'rec_yds'],
    'rushing_yards': ['rushingYards', 'rushing_yds', 'rush_yds'],
    'receptions': ['receivingReceptions', 'receptions', 'rec'],
    'touchdowns': ['touchdowns', 'total_td', 'td'],
    'points': ['points', 'pts'],
    'rebounds': ['totalRebounds', 'rebounds', 'reb'],
    'assists': ['assists', 'ast'],
    'shots_on_goal': ['shots', 'sog'],
    'goals': ['goals', 'goal'],
    'hits': ['hits'],
    '3_pointers': ['threePointFieldGoalsMade', 'three_pointers', '3p']
  };

  const categoryKey = category.toLowerCase().replace(/[-\s]/g, '_');
  const possibleNames = categoryMap[categoryKey] || [category];

  // First check if game has a stats object
  if (game.stats && typeof game.stats === 'object') {
    for (const [key, value] of Object.entries(game.stats)) {
      const normalizedKey = key.toLowerCase().replace(/[-\s]/g, '_');
      
      for (const possibleName of possibleNames) {
        const normalized = possibleName.toLowerCase().replace(/[-\s]/g, '_');
        
        if (normalizedKey.includes(normalized) || normalized.includes(normalizedKey)) {
          const numValue = parseInt(value) || parseFloat(value) || 0;
          if (!isNaN(numValue)) {
            console.log(`    ✅ Found ${category}: ${numValue} (from field: ${key})`);
            return numValue;
          }
        }
      }
    }
  }

  // Also check top-level properties
  for (const possibleName of possibleNames) {
    const normalized = possibleName.toLowerCase().replace(/[-\s]/g, '_');
    for (const [key, value] of Object.entries(game)) {
      const normalizedKey = key.toLowerCase().replace(/[-\s]/g, '_');
      
      if (normalizedKey.includes(normalized) || normalized.includes(normalizedKey)) {
        const numValue = parseInt(value) || parseFloat(value) || 0;
        if (!isNaN(numValue)) {
          console.log(`    ✅ Found ${category}: ${numValue} (from field: ${key})`);
          return numValue;
        }
      }
    }
  }

  console.log(`    ⚠️ Could not find stat "${category}" in gamelog`);
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
