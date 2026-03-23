// FILE LOCATION: api/utils/results-processor.js
// Thin wrapper used by other parts of the app to check pick results.
// Now delegates to espn-client instead of using mock data.

import { getPlayerStatForGame, isGameComplete } from './espn-client.js';

/**
 * Process all legs of a submitted pick and return win/loss per leg.
 * Used by the dashboard and history pages to display results.
 *
 * @param {object} pick - The pick document from Firestore
 * @param {string|Date} gameDate - Date of the game
 * @returns {object} result summary
 */
export async function processPickResults(pick, gameDate) {
  try {
    const pickLegs = pick.legs || pick.picks || [];
    const sport = pick.sport || 'NBA';

    if (pickLegs.length === 0) {
      return { status: 'error', reason: 'No pick legs found' };
    }

    let legsWon = 0;
    const legResults = [];

    for (let i = 0; i < pickLegs.length; i++) {
      const leg = pickLegs[i];

      const result = await getPlayerStatForGame(
        sport,
        leg.player,
        leg.stat,
        gameDate,
      );

      if (result.gameStatus === 'pre_game' || result.gameStatus === 'in_progress') {
        return { status: 'pending', reason: 'Game not yet complete' };
      }

      if (!result.found || result.value === null) {
        legResults.push({
          legNumber: i + 1,
          player: leg.player,
          stat: leg.stat,
          threshold: leg.threshold || leg.line,
          actualValue: null,
          result: 'UNKNOWN',
          reason: result.error || 'Could not retrieve stat',
        });
        continue;
      }

      // Support both "threshold" (old schema: "230+") and "line" + "bet_type" (new schema)
      let won;
      if (leg.threshold) {
        const thresholdNum = parseFloat(String(leg.threshold).replace(/[^0-9.]/g, ''));
        const isOver = !String(leg.threshold).includes('-');
        won = isOver ? result.value >= thresholdNum : result.value <= thresholdNum;
      } else {
        const type = (leg.bet_type || 'over').toLowerCase();
        const lineNum = parseFloat(leg.line);
        won = type === 'under' ? result.value < lineNum : result.value > lineNum;
      }

      if (won) legsWon++;

      legResults.push({
        legNumber: i + 1,
        player: leg.player,
        playerFullName: result.playerFullName,
        stat: leg.stat,
        threshold: leg.threshold || `${leg.bet_type} ${leg.line}`,
        actualValue: result.value,
        result: won ? 'WON' : 'LOST',
        buffer: result.value - parseFloat(String(leg.threshold || leg.line).replace(/[^0-9.]/g, '')),
        gameId: result.gameId,
      });
    }

    const parlayWon = legsWon === pickLegs.length;
    const wager = pick.wager || pick.wager_amount || 0;
    const odds = pick.originalOdds ? parseOdds(pick.originalOdds) : 900;
    const actualPayout = parlayWon ? wager * ((Math.abs(odds) + 100) / 100) : 0;
    const actualROI = wager > 0 ? ((actualPayout - wager) / wager) * 100 : 0;

    return {
      status: parlayWon ? 'won' : 'lost',
      legResults,
      legsWon,
      totalLegs: pickLegs.length,
      actualPayout,
      actualROI,
      processedAt: new Date().toISOString(),
      source: 'espn_api',
    };

  } catch (error) {
    console.error('[results-processor] Error:', error);
    return { status: 'error', reason: error.message };
  }
}

function parseOdds(oddsStr) {
  if (!oddsStr) return 900;
  const num = parseInt(String(oddsStr).replace(/[^0-9-+]/g, ''), 10);
  return isNaN(num) ? 900 : num;
}
