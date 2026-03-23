// FILE LOCATION: api/cron/fetch-game-results.js
// Daily cron job: Grade pending bets using ESPN public API box scores.
// Replaces the previous SerpAPI + regex approach entirely.
//
// Flow:
//   1. Pull all users with bets in status "pending_results"
//   2. For each pick leg, call espn-client.getPlayerStatForGame()
//   3. Compare final stat vs the line + bet_type (Over/Under/Moneyline)
//   4. When ALL legs are resolved, mark the bet complete in Firestore

import { initializeApp, cert, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getPlayerStatForGame } from '../utils/espn-client.js';

// ─── Firebase init ────────────────────────────────────────────────────────────

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');

let app;
try {
  app = getApp();
} catch {
  app = initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore(app);

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate cron secret — set CRON_SECRET in both Vercel env vars and
  // GitHub Actions secrets to lock this endpoint down.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided = req.headers['x-cron-secret'];
    if (!provided || provided !== cronSecret) {
      console.warn('❌ Unauthorized cron attempt — invalid or missing secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    console.log('🏟️  ESPN result fetch started at', new Date().toISOString());

    const usersSnapshot = await db.collection('users').get();
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    const errors = [];

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;

      const betsSnapshot = await db
        .collection('users')
        .doc(userId)
        .collection('bets')
        .where('status', '==', 'pending_results')
        .get();

      for (const betDoc of betsSnapshot.docs) {
        const bet = betDoc.data();
        const betId = betDoc.id;
        totalProcessed++;

        try {
          const result = await gradeBet(bet, betId, userId);

          if (result.updated) {
            totalUpdated++;
            console.log(`✅ Graded bet ${betId}: ${result.summary}`);
          } else if (result.skipped) {
            totalSkipped++;
            console.log(`⏳ Skipped bet ${betId}: ${result.reason}`);
          }
        } catch (err) {
          errors.push({ betId, error: err.message });
          console.error(`❌ Error on bet ${betId}:`, err.message);
        }
      }
    }

    console.log(`✅ Done. Processed: ${totalProcessed}, Updated: ${totalUpdated}, Skipped: ${totalSkipped}`);

    // Grade pending halftime picks
    const halftimeResults = await gradeHalftimePicks();

    return res.status(200).json({
      success: true,
      processed: totalProcessed,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors,
      halftime: halftimeResults,
    });

  } catch (err) {
    console.error('❌ Cron job fatal error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Core grading logic ───────────────────────────────────────────────────────

async function gradeBet(bet, betId, userId) {
  const picks = bet.picks || [];
  if (picks.length === 0) {
    return { updated: false, skipped: true, reason: 'No picks on bet' };
  }

  const gameDate = bet.game_date || bet.created_at?.toDate?.() || bet.created_at || new Date();

  const outcomes = [];
  let allResolved = true;
  let anyGameStillLive = false;

  for (const pick of picks) {
    const sport = normalizeSport(pick.sport);
    const result = await getPlayerStatForGame(
      sport,
      pick.player,
      pick.stat,
      gameDate,
    );

    console.log(
      `  🔍 ${pick.player} | ${pick.stat} | game: ${result.gameId} | ` +
      `status: ${result.gameStatus} | value: ${result.value} | found: ${result.found}`
    );

    if (result.gameStatus === 'in_progress' || result.gameStatus === 'pre_game') {
      anyGameStillLive = true;
      allResolved = false;
      break;
    }

    if (!result.found || result.value === null) {
      const hoursOld = (Date.now() - new Date(gameDate).getTime()) / 3600000;
      if (hoursOld > 72) {
        outcomes.push({
          player: pick.player,
          stat: pick.stat,
          bet_type: pick.bet_type,
          line: pick.line,
          final_value: null,
          result: 'VOID',
          reason: result.error || 'Player stat not found',
          source: 'espn',
        });
      } else {
        allResolved = false;
      }
      continue;
    }

    const won = evaluatePick(result.value, pick.line, pick.bet_type);

    outcomes.push({
      player: pick.player,
      stat: pick.stat,
      bet_type: pick.bet_type,
      line: pick.line,
      final_value: result.value,
      result: won ? 'Won' : 'Lost',
      player_full_name: result.playerFullName,
      game_id: result.gameId,
      source: 'espn',
    });
  }

  if (!allResolved) {
    return {
      updated: false,
      skipped: true,
      reason: anyGameStillLive ? 'Game still in progress' : 'Some picks unresolvable',
    };
  }

  if (outcomes.length !== picks.length) {
    return {
      updated: false,
      skipped: true,
      reason: `Only resolved ${outcomes.length}/${picks.length} picks`,
    };
  }

  const betWon = outcomes.every(o => o.result === 'Won');
  const anyVoid = outcomes.some(o => o.result === 'VOID');
  const betResult = anyVoid ? 'VOID' : betWon ? 'Won' : 'Lost';
  const profitLoss = calculateProfitLoss(bet, betResult);

  await db
    .collection('users')
    .doc(userId)
    .collection('bets')
    .doc(betId)
    .update({
      status: 'complete',
      outcomes,
      profit_loss: profitLoss,
      bet_result: betResult,
      completed_at: new Date(),
      result_source: 'espn_api',
    });

  return {
    updated: true,
    summary: `${betResult} | P/L: ${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)}`,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function evaluatePick(finalValue, line, betType) {
  if (finalValue === null || finalValue === undefined) return false;
  const type = (betType || '').toLowerCase();
  const lineNum = parseFloat(line);

  if (type === 'over' || type === 'more' || type === '+') return finalValue > lineNum;
  if (type === 'under' || type === 'less' || type === '-') return finalValue < lineNum;
  if (type === 'moneyline') return finalValue > 0;
  return finalValue > lineNum; // default: over
}

function calculateProfitLoss(bet, betResult) {
  const wager = bet.wager_amount || 0;
  if (betResult === 'VOID') return 0;
  if (betResult === 'Won') {
    if (bet.potential_payout) return bet.potential_payout - wager;
    const odds = bet.picks?.[0]?.odds || -110;
    if (odds > 0) return (wager / 100) * odds;
    return wager / (Math.abs(odds) / 100);
  }
  return -wager;
}

function normalizeSport(sport) {
  if (!sport) return 'NBA';
  const s = sport.toUpperCase().trim();
  if (s.includes('NFL') || s.includes('FOOTBALL')) return 'NFL';
  if (s.includes('NBA') || s.includes('BASKETBALL')) return 'NBA';
  if (s.includes('MLB') || s.includes('BASEBALL')) return 'MLB';
  if (s.includes('NHL') || s.includes('HOCKEY')) return 'NHL';
  if (s.includes('NCAAF') || s.includes('COLLEGE FOOTBALL')) return 'NCAAF';
  if (s.includes('NCAAB') || s.includes('COLLEGE BASKETBALL')) return 'NCAAB';
  return s;
}
