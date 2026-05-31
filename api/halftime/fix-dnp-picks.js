// FILE LOCATION: api/halftime/fix-dnp-picks.js
// ONE-TIME SCRIPT — Re-grades MLB halftime picks that were wrongly marked as
// 'miss' when the player likely didn't play (actual_value === 0, low projection).
//
// Run once by visiting:
//   https://your-vercel-url.vercel.app/api/halftime/fix-dnp-picks?secret=YOUR_CRON_SECRET
//
// After confirming results, delete this file and redeploy.

import { initializeApp, cert, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');

let app;
try { app = getApp(); } catch {
  app = initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore(app);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  

  // Pass ?commit=true to actually write changes. Without it, dry run only.
  const dryRun = req.query.commit !== 'true';

  try {
    // Fetch all MLB picks graded as 'miss' with actual_value of 0
    // created on or after MLB tracking start date (March 24 2026)
    const snapshot = await db
      .collection('halftime_picks')
      .where('status', '==', 'miss')
      .where('actual_value', '==', 0)
      .get();

    const startDate = new Date('2026-03-24');
    const candidates = [];
    const skipped = [];

    for (const doc of snapshot.docs) {
      const pick = doc.data();

      // Only MLB picks
      const league = (pick.league || pick.sport || '').toLowerCase();
      if (!league.includes('mlb') && !league.includes('baseball')) {
        skipped.push({ id: doc.id, reason: 'not MLB', player: pick.player });
        continue;
      }

      // Only picks from March 24 onwards
      const createdAt = pick.created_at?.toDate?.() || new Date(pick.created_at);
      if (createdAt < startDate) {
        skipped.push({ id: doc.id, reason: 'before tracking start', player: pick.player });
        continue;
      }

      // Only void if projection was above 0.3 (true DNP signal)
      const projection =
        pick.projection?.blended ||
        pick.projection?.conservative ||
        0;

      if (projection <= 0.3) {
        skipped.push({ id: doc.id, reason: `projection too low (${projection})`, player: pick.player });
        continue;
      }

      candidates.push({
        id: doc.id,
        player: pick.player,
        stat: pick.stat,
        gameDate: pick.gameDate,
        projection,
        ref: doc.ref,
      });
    }

    // Apply the fix if not a dry run
    if (!dryRun && candidates.length > 0) {
      const batch = db.batch();
      for (const c of candidates) {
        batch.update(c.ref, {
          status: 'void',
          grade_note: 'Retroactively voided — likely DNP (0 actual vs MLB projection)',
          regraded_at: new Date(),
        });
      }
      await batch.commit();
    }

    return res.status(200).json({
      success: true,
      dry_run: dryRun,
      message: dryRun
        ? 'DRY RUN — no changes written. Add ?commit=true to apply.'
        : `Voided ${candidates.length} picks.`,
      would_void: candidates.map(c => ({
        id: c.id,
        player: c.player,
        stat: c.stat,
        gameDate: c.gameDate,
        projection: c.projection,
      })),
      skipped_count: skipped.length,
      skipped,
    });

  } catch (err) {
    console.error('[fix-dnp-picks] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
