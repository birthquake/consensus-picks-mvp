// FILE LOCATION: api/cron/update-stats.js
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

let db;
try {
  const adminApp = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
  db = getAdminFirestore(adminApp);
} catch (error) {
  db = getAdminFirestore();
}

export default async function handler(req, res) {
  // Verify cron request
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('📊 [CRON] Starting update-stats job');

    const usersSnapshot = await db.collection('users').get();
    let updatedUsers = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;

      // Get all settled picks
      const picksSnapshot = await db
        .collection('users')
        .doc(userId)
        .collection('submitted_picks')
        .where('status', 'in', ['won', 'lost'])
        .get();

      let totalSubmitted = 0;
      let totalWon = 0;
      let totalLost = 0;
      let totalROI = 0;
      const sportStats = {};
      const playerStats = {};

      for (const pickDoc of picksSnapshot.docs) {
        const pick = pickDoc.data();
        totalSubmitted++;

        if (pick.status === 'won') {
          totalWon++;
        } else {
          totalLost++;
        }

        // Track by sport
        if (!sportStats[pick.sport]) {
          sportStats[pick.sport] = { won: 0, lost: 0, roi: 0 };
        }
        sportStats[pick.sport][pick.status === 'won' ? 'won' : 'lost']++;

        if (pick.result?.actualROI) {
          totalROI += pick.result.actualROI;
          sportStats[pick.sport].roi += pick.result.actualROI;
        }

        // Track by player
        if (pick.originalLegs) {
          pick.originalLegs.forEach(leg => {
            if (!playerStats[leg.player]) {
              playerStats[leg.player] = { hits: 0, total: 0 };
            }
            playerStats[leg.player].total++;

            // Check if this leg won
            const legResult = pick.result?.legResults?.find(
              lr => lr.player === leg.player
            );
            if (legResult?.result === 'WON') {
              playerStats[leg.player].hits++;
            }
          });
        }
      }

      // Calculate aggregates
      const overallROI = totalSubmitted > 0 ? (totalROI / totalSubmitted) : 0;
      const currentWinRate = totalSubmitted > 0 ? (totalWon / totalSubmitted) : 0;

      // Find best sport
      let bestSport = null;
      let bestWinRate = 0;
      for (const [sport, stats] of Object.entries(sportStats)) {
        const winRate = (stats.won / (stats.won + stats.lost)) || 0;
        if (winRate > bestWinRate) {
          bestWinRate = winRate;
          bestSport = sport;
        }
      }

      // Update user performance stats
      await db
        .collection('users')
        .doc(userId)
        .collection('performance_stats')
        .doc('overall')
        .set({
          totalSubmitted,
          totalWon,
          totalLost,
          currentWinRate: Math.round(currentWinRate * 1000) / 1000,
          overallROI: Math.round(overallROI * 100) / 100,
          bestSport,
          sportBreakdown: Object.fromEntries(
            Object.entries(sportStats).map(([sport, stats]) => [
              sport,
              {
                won: stats.won,
                lost: stats.lost,
                winRate: Math.round((stats.won / (stats.won + stats.lost)) * 1000) / 1000,
                avgROI: Math.round((stats.roi / (stats.won + stats.lost)) * 100) / 100
              }
            ])
          ),
          playerBreakdown: Object.fromEntries(
            Object.entries(playerStats).map(([player, stats]) => [
              player,
              {
                hits: stats.hits,
                total: stats.total,
                hitRate: Math.round((stats.hits / stats.total) * 1000) / 1000
              }
            ])
          ),
          lastUpdated: new Date().toISOString()
        });

      updatedUsers++;
    }

    console.log(`✅ [CRON] Updated stats for ${updatedUsers} users`);

    res.status(200).json({
      success: true,
      message: `Updated stats for ${updatedUsers} users`
    });

  } catch (error) {
    console.error('❌ [CRON] Error in update-stats:', error);
    res.status(500).json({
      error: error.message
    });
  }
}
