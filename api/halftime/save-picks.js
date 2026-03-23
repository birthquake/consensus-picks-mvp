// FILE LOCATION: api/halftime/save-picks.js
// Saves Claude's halftime recommendations to Firestore for outcome tracking.
// Called automatically by the UI when analysis results come back.
// No wager required — purely for measuring model accuracy over time.
//
// Usage: POST /api/halftime/save-picks
// Body: { gameId, sport, league, gameName, gameDate, picks, projections }

import { initializeApp, cert, getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');

let app;
try { app = getApp(); } catch {
  app = initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore(app);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gameId, sport, league, gameName, gameDate, picks, projections } = req.body;

  if (!gameId || !picks?.length) {
    return res.status(400).json({ error: 'Missing gameId or picks' });
  }

  try {
    const batch = db.batch();
    const savedIds = [];

    for (const pick of picks) {
      // Look up this player's projection snapshot if available
      const playerProj = projections?.[pick.player] || null;

      const docRef = db.collection('halftime_picks').doc();
      savedIds.push(docRef.id);

      batch.set(docRef, {
        // Game context
        gameId,
        sport,
        league,
        gameName:  gameName  || null,
        gameDate:  gameDate  || new Date().toISOString().split('T')[0],

        // Pick recommendation
        player:    pick.player,
        team:      pick.team,
        stat:      pick.stat,
        direction: pick.direction,  // "Over" | "Under"
        rating:    pick.rating,     // 1-5
        rationale: pick.rationale,
        rating_reason: pick.rating_reason,
        risk_flags: pick.risk_flags || [],

        // Projection snapshot at time of recommendation
        projection: playerProj ? {
          conservative:              playerProj.conservative              || null,
          blended:                   playerProj.blended                   || null,
          aggressive:                playerProj.aggressive                || null,
          projectedRemainingMinutes: playerProj.projectedRemainingMinutes || null,
          firstHalfValue:            playerProj.firstHalfValue            || null,
          firstHalfMinutes:          playerProj.firstHalfMinutes          || null,
          vsExpected:                playerProj.vsExpected                || null,
          seasonAvg:                 playerProj.seasonAvg                 || null,
        } : null,

        // Result (filled by cron after game ends)
        status:       'pending',   // pending | hit | miss | void
        actual_value: null,        // final stat value from ESPN box score
        hit:          null,        // true | false | null
        // How far off was the blended projection?
        projection_error: null,    // actual_value - blended_projection
        projection_error_pct: null,// % error

        created_at:   FieldValue.serverTimestamp(),
        graded_at:    null,
      });
    }

    await batch.commit();

    console.log(`[save-picks] Saved ${savedIds.length} picks for game ${gameId}`);

    return res.status(200).json({
      success: true,
      saved: savedIds.length,
      ids: savedIds,
    });

  } catch (err) {
    console.error('[save-picks] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
