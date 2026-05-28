// FILE LOCATION: api/halftime/save-picks.js
// Saves Claude's halftime recommendations to Firestore for outcome tracking.
// Called automatically by the UI when analysis results come back.
// No wager required — purely for measuring model accuracy over time.
//
// Usage: POST /api/halftime/save-picks
// Body: { gameId, sport, league, gameName, gameDate, picks, projections }
//
// Also handles: POST /api/halftime/save-picks { action: 'mark_twitter', pickIds: [...] }
// Marks specific picks as posted to Twitter for separate hit rate tracking.

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

  // ── Mark existing picks as posted to Twitter ─────────────────────────────
  if (req.body.action === 'mark_twitter') {
    const { pickIds } = req.body;
    if (!pickIds?.length) {
      return res.status(400).json({ error: 'Missing pickIds' });
    }

    try {
      const batch = db.batch();
      for (const id of pickIds) {
        const ref = db.collection('halftime_picks').doc(id);
        batch.update(ref, {
          posted_to_twitter: true,
          twitter_posted_at: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      console.log(`[save-picks] Marked ${pickIds.length} picks as posted to Twitter`);
      return res.status(200).json({ success: true, marked: pickIds.length });
    } catch (err) {
      console.error('[save-picks] mark_twitter error:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── Save new picks ────────────────────────────────────────────────────────
  const { gameId, sport, league, gameName, gameDate, picks, projections } = req.body;

  if (!gameId || !picks?.length) {
    return res.status(400).json({ error: 'Missing gameId or picks' });
  }

  try {
    // Check for existing picks for this game to avoid duplicates
    const existingSnap = await db
      .collection('halftime_picks')
      .where('gameId', '==', gameId)
      .where('status', '==', 'pending')
      .get();

    const existingKeys = new Set(
      existingSnap.docs.map(d => `${d.data().player}:${d.data().stat}`)
    );

    // Also collect existing doc IDs by key so we can return them for Twitter marking
    const existingIdsByKey = {};
    existingSnap.docs.forEach(d => {
      const key = `${d.data().player}:${d.data().stat}`;
      existingIdsByKey[key] = d.id;
    });

    const batch = db.batch();
    const savedIds = [];
    const savedKeys = {};  // key → docId, for all picks (new + existing)
    let skipped = 0;

    // Include existing picks in the key→id map so UI can mark them as Twitter posts
    Object.entries(existingIdsByKey).forEach(([key, id]) => {
      savedKeys[key] = id;
    });

    for (const pick of picks) {
      const pickKey = `${pick.player}:${pick.stat}`;
      if (existingKeys.has(pickKey)) {
        skipped++;
        continue; // already saved — skip duplicate
      }

      const playerProj = projections?.[pick.player] || null;

      const docRef = db.collection('halftime_picks').doc();
      savedIds.push(docRef.id);
      savedKeys[pickKey] = docRef.id;

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
        direction: pick.direction,
        rating:    pick.rating,
        rationale: pick.rationale,
        rating_reason: pick.rating_reason,
        risk_flags: pick.risk_flags || [],
        model:     pick.model || null,

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

        // Twitter tracking
        posted_to_twitter: false,
        twitter_posted_at: null,

        // Result (filled by cron after game ends)
        status:       'pending',
        actual_value: null,
        hit:          null,
        projection_error: null,
        projection_error_pct: null,

        created_at:   FieldValue.serverTimestamp(),
        graded_at:    null,
      });
    }

    await batch.commit();

    console.log(`[save-picks] Saved ${savedIds.length}, skipped ${skipped} duplicates for game ${gameId}`);

    return res.status(200).json({
      success: true,
      saved: savedIds.length,
      skipped,
      ids: savedIds,
      // Return key→id map so UI can mark specific picks as Twitter posts
      pick_ids: savedKeys,
    });

  } catch (err) {
    console.error('[save-picks] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
