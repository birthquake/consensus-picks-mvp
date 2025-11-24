// FILE LOCATION: api/cron/process-results.js
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { processPickResults } from '../utils/results-processor.js';

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
  // Verify this is a cron request from Vercel
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🔄 [CRON] Starting process-results job');

    // Get all users
    const usersSnapshot = await db.collection('users').get();
    let processedCount = 0;
    let updatedCount = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;

      // Get all pending picks for this user
      const picksSnapshot = await db
        .collection('users')
        .doc(userId)
        .collection('submitted_picks')
        .where('status', '==', 'analyzed')
        .get();

      for (const pickDoc of picksSnapshot.docs) {
        const pick = pickDoc.data();
        const pickId = pickDoc.id;

        // Process the result
        const result = await processPickResults(pick, pick.submittedAt);

        if (result.status !== 'pending' && result.status !== 'error') {
          // Update pick with results
          await db
            .collection('users')
            .doc(userId)
            .collection('submitted_picks')
            .doc(pickId)
            .update({
              status: result.status,
              result: {
                legResults: result.legResults,
                legsWon: result.legsWon,
                totalLegs: result.totalLegs,
                actualPayout: result.actualPayout,
                actualROI: result.actualROI,
                processedAt: result.processedAt
              }
            });

          updatedCount++;
        }

        processedCount++;
      }
    }

    console.log(`✅ [CRON] Processed ${processedCount} picks, updated ${updatedCount}`);

    res.status(200).json({
      success: true,
      message: `Processed ${processedCount} picks, updated ${updatedCount}`
    });

  } catch (error) {
    console.error('❌ [CRON] Error in process-results:', error);
    res.status(500).json({
      error: error.message
    });
  }
}
