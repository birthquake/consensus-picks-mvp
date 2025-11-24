// FILE LOCATION: api/utils/results-processor.js

export async function processPickResults(pick, gameDate) {
  try {
    const pickLegs = pick.originalLegs || [];
    const game = pick.game;
    const sport = pick.sport;

    // Check if game is complete
    const gameStatus = await checkGameStatus(sport, game, gameDate);
    
    if (gameStatus !== 'COMPLETE') {
      return {
        status: 'pending',
        reason: 'Game not yet complete'
      };
    }

    // Get actual player stats from ESPN
    const actualStats = await getActualPlayerStats(sport, game);

    // Check each leg
    let legsWon = 0;
    let legResults = [];

    for (let i = 0; i < pickLegs.length; i++) {
      const leg = pickLegs[i];
      const playerStat = actualStats[leg.player];

      if (!playerStat) {
        legResults.push({
          legNumber: i + 1,
          player: leg.player,
          stat: leg.stat,
          threshold: leg.threshold,
          actualValue: null,
          result: 'UNKNOWN',
          reason: 'Player stat not found'
        });
        continue;
      }

      const thresholdNum = parseInt(leg.threshold);
      const actualValue = playerStat[leg.stat];
      const won = actualValue >= thresholdNum;

      if (won) legsWon++;

      legResults.push({
        legNumber: i + 1,
        player: leg.player,
        stat: leg.stat,
        threshold: leg.threshold,
        actualValue: actualValue,
        result: won ? 'WON' : 'LOST',
        buffer: actualValue - thresholdNum
      });
    }

    // All legs must win for parlay to win
    const parlalyWon = legsWon === pickLegs.length;

    // Calculate payout
    const odds = 900; // Default, should be from pick data
    const wager = pick.wager || 2;
    const actualPayout = parlalyWon ? wager * ((odds + 100) / 100) : 0;
    const actualROI = ((actualPayout - wager) / wager) * 100;

    return {
      status: parlalyWon ? 'won' : 'lost',
      legResults,
      legsWon,
      totalLegs: pickLegs.length,
      actualPayout,
      actualROI,
      processedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error processing pick results:', error);
    return {
      status: 'error',
      reason: error.message
    };
  }
}

async function checkGameStatus(sport, game, gameDate) {
  try {
    // Mock implementation - would call ESPN API in production
    const now = new Date();
    const gameDateObj = new Date(gameDate);
    
    // Games typically last 3-4 hours
    const gameEndTime = new Date(gameDateObj.getTime() + 4 * 60 * 60 * 1000);
    
    if (now >= gameEndTime) {
      return 'COMPLETE';
    }
    return 'IN_PROGRESS';
  } catch (error) {
    return 'UNKNOWN';
  }
}

async function getActualPlayerStats(sport, game) {
  // Mock player stats - in production this would fetch from ESPN
  const mockStats = {
    NFL: {
      'Patrick Mahomes': { 'Passing Yards': 285, 'Touchdowns': 2 },
      'Travis Kelce': { 'Receiving Yards': 95, 'Receptions': 9 },
      'Rashee Rice': { 'Receiving Yards': 72, 'Receptions': 8 },
      'Isiah Pacheco': { 'Rushing Yards': 58 },
      'James Robinson': { 'Rushing Yards': 88 }
    },
    NBA: {
      'LeBron James': { 'Points': 28, 'Rebounds': 9, 'Assists': 7 },
      'Jayson Tatum': { 'Points': 32, 'Rebounds': 11, 'Assists': 5 },
      'Nikola Jokic': { 'Points': 29, 'Rebounds': 14, 'Assists': 10 }
    },
    NHL: {
      'Connor McDavid': { 'Shots on Goal': 5, 'Goals': 1, 'Assists': 2 }
    }
  };

  return mockStats[sport] || {};
}
