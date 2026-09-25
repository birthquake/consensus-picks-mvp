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
import { getPlayerStatForGame } from '../../lib/espn-client.js';

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

    // Grade pending moneyline picks
    const moneylineResults = await gradeMoneylinePicks();

    return res.status(200).json({
      success: true,
      processed: totalProcessed,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors,
      halftime: halftimeResults,
      moneyline: moneylineResults,
    });

  } catch (err) {
    console.error('❌ Cron job fatal error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Halftime pick grading ────────────────────────────────────────────────────

async function gradeHalftimePicks() {
  const results = { processed: 0, graded: 0, skipped: 0, errors: [] };

  try {
    const snapshot = await db
      .collection('halftime_picks')
      .where('status', '==', 'pending')
      .get();

    results.processed = snapshot.docs.length;

    for (const doc of snapshot.docs) {
      const pick = doc.data();

      try {
        const gameDate = pick.gameDate || pick.game_date;
        if (!gameDate) { results.skipped++; continue; }

        // Use end-of-day (23:59) as the reference point so picks from any
        // game on a given date pass this gate once the day is over.
        // Previously used raw gameDate timestamp (often midnight UTC) which
        // caused all 104 pending picks to be permanently skipped.
        const pickDate = new Date(gameDate);
        pickDate.setHours(23, 59, 0, 0);
        const now = new Date();
        const hoursSinceGame = (now - pickDate) / 3600000;
        if (hoursSinceGame < 4) { results.skipped++; continue; }

        const sport = normalizeSport(pick.sport);
        const result = await getPlayerStatForGame(
          sport,
          pick.player,
          pick.stat,
          gameDate,
        );

        if (!result.found || result.value === null) {
          if (result.gameStatus === 'final' && hoursSinceGame > 12) {
            await doc.ref.update({
              status: 'void',
              graded_at: new Date(),
              grade_note: result.error || 'Stat not found after 12h',
            });
          }
          results.skipped++;
          continue;
        }

        if (result.gameStatus !== 'final') { results.skipped++; continue; }

        const actualValue = result.value;

        // Void if player DNP — 0 across all counting stats suggests no minutes
        // Check minutes played if available, otherwise check if all main stats are 0
        if (result.minutes !== undefined && result.minutes === 0) {
          await doc.ref.update({
            status: 'void',
            actual_value: 0,
            graded_at: new Date(),
            grade_note: 'DNP — 0 minutes played',
          });
          results.graded++;
          console.log(`⚪ Halftime pick voided (DNP): ${pick.player} ${pick.stat}`);
          continue;
        }

        // Also void if the stat value is suspiciously 0 for a starter-level player
        // who had a projection > 5 (suggests DNP or injury scratch)
        const projection = pick.projection?.blended || pick.projection?.conservative || 0;
        const dnpThreshold = (pick.sport === 'mlb' || pick.league === 'mlb') ? 0.3 : 8;
        if (actualValue === 0 && projection > dnpThreshold) {
          await doc.ref.update({
            status: 'void',
            actual_value: 0,
            graded_at: new Date(),
            grade_note: 'Likely DNP — 0 actual vs high projection suggests scratch',
          });
          results.graded++;
          console.log(`⚪ Halftime pick voided (likely DNP): ${pick.player} ${pick.stat} (proj: ${projection})`);
          continue;
        }

        const hit = pick.direction === 'Over'
          ? actualValue > (pick.projection?.blended || 0)
          : actualValue < (pick.projection?.blended || Infinity);

        const blended = pick.projection?.blended;
        const projError = blended != null ? Math.round((actualValue - blended) * 10) / 10 : null;
        const projErrorPct = blended != null && blended > 0
          ? Math.round(((actualValue - blended) / blended) * 100)
          : null;

        await doc.ref.update({
          status:               hit ? 'hit' : 'miss',
          actual_value:         actualValue,
          hit,
          projection_error:     projError,
          projection_error_pct: projErrorPct,
          graded_at:            new Date(),
          game_status_at_grade: result.gameStatus,
        });

        results.graded++;
        console.log(`✅ Halftime pick graded: ${pick.player} ${pick.stat} ${pick.direction} → actual ${actualValue} (${hit ? 'HIT' : 'MISS'})`);

      } catch (err) {
        results.errors.push({ id: doc.id, player: pick.player, error: err.message });
        console.error(`❌ Error grading halftime pick ${doc.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[gradeHalftimePicks] Fatal:', err.message);
    results.errors.push({ error: err.message });
  }

  console.log(`[gradeHalftimePicks] Graded: ${results.graded}/${results.processed}`);
  return results;
}

// ─── Moneyline pick grading ───────────────────────────────────────────────────

async function fetchWithTimeout(url, ms = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function gradeMoneylinePicks() {
  const results = { processed: 0, graded: 0, skipped: 0, errors: [] };

  try {
    const snapshot = await db
      .collection('moneyline_picks')
      .where('status', '==', 'pending')
      .get();

    results.processed = snapshot.docs.length;

    for (const doc of snapshot.docs) {
      const pick = doc.data();

      try {
        const summary = await fetchWithTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/${pick.sport}/${pick.league}/summary?event=${pick.gameId}`
        );

        if (!summary) { results.skipped++; continue; }

        const comp = summary.header?.competitions?.[0];
        const statusType = comp?.status?.type;

        if (!statusType?.completed) { results.skipped++; continue; }

        const name = statusType.name || '';
        if (name.includes('POSTPONED') || name.includes('CANCELED') || name.includes('CANCELLED')) {
          await doc.ref.update({
            status: 'void',
            graded_at: new Date(),
            grade_note: 'Game postponed/cancelled',
          });
          results.graded++;
          continue;
        }

        const home = comp?.competitors?.find(c => c.homeAway === 'home');
        const away = comp?.competitors?.find(c => c.homeAway === 'away');
        const homeScore = parseInt(home?.score, 10);
        const awayScore = parseInt(away?.score, 10);

        if (isNaN(homeScore) || isNaN(awayScore)) { results.skipped++; continue; }

        if (homeScore === awayScore) {
          await doc.ref.update({
            status: 'void',
            graded_at: new Date(),
            grade_note: 'Unresolvable tie',
          });
          results.graded++;
          continue;
        }

        const winner = homeScore > awayScore ? home : away;
        const actualWinnerAbbrev = winner?.team?.abbreviation;
        const hit = actualWinnerAbbrev === pick.teamAbbrev;

        await doc.ref.update({
          status: hit ? 'hit' : 'miss',
          actual_winner: actualWinnerAbbrev,
          hit,
          graded_at: new Date(),
        });

        results.graded++;
        console.log(`✅ Moneyline pick graded: ${pick.team} vs ${pick.opponent} → winner ${actualWinnerAbbrev} (${hit ? 'HIT' : 'MISS'})`);

      } catch (err) {
        results.errors.push({ id: doc.id, team: pick.team, error: err.message });
        console.error(`❌ Error grading moneyline pick ${doc.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[gradeMoneylinePicks] Fatal:', err.message);
    results.errors.push({ error: err.message });
  }

  console.log(`[gradeMoneylinePicks] Graded: ${results.graded}/${results.processed}`);
  return results;
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
