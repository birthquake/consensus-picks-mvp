// FILE LOCATION: api/halftime/stats.js
// Returns aggregate accuracy metrics for all tracked halftime picks.
// Used by the UI to show model performance over time.
//
// Usage: GET /api/halftime/stats?days=30

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

  const days = parseInt(req.query.days || '30');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  try {
    const snapshot = await db
      .collection('halftime_picks')
      .where('created_at', '>=', cutoff)
      .get();

    const all    = snapshot.docs.map(d => d.data());
    const graded = all.filter(p => p.status === 'hit' || p.status === 'miss');
    const hits   = graded.filter(p => p.hit === true);
    const misses = graded.filter(p => p.hit === false);

    // Overall hit rate
    const hitRate = graded.length > 0
      ? Math.round((hits.length / graded.length) * 100)
      : null;

    // By star rating
    const byRating = {};
    for (let r = 1; r <= 5; r++) {
      const rGraded = graded.filter(p => p.rating === r);
      const rHits   = rGraded.filter(p => p.hit);
      byRating[r] = {
        total:   rGraded.length,
        hits:    rHits.length,
        hitRate: rGraded.length > 0 ? Math.round((rHits.length / rGraded.length) * 100) : null,
      };
    }

    // By stat category
    const byStat = {};
    for (const pick of graded) {
      const stat = pick.stat || 'Unknown';
      if (!byStat[stat]) byStat[stat] = { total: 0, hits: 0 };
      byStat[stat].total++;
      if (pick.hit) byStat[stat].hits++;
    }
    for (const stat of Object.keys(byStat)) {
      const d = byStat[stat];
      d.hitRate = d.total > 0 ? Math.round((d.hits / d.total) * 100) : null;
    }

    // By direction (Over vs Under)
    const byDirection = {};
    for (const pick of graded) {
      const dir = pick.direction || 'Unknown';
      if (!byDirection[dir]) byDirection[dir] = { total: 0, hits: 0 };
      byDirection[dir].total++;
      if (pick.hit) byDirection[dir].hits++;
    }
    for (const dir of Object.keys(byDirection)) {
      const d = byDirection[dir];
      d.hitRate = d.total > 0 ? Math.round((d.hits / d.total) * 100) : null;
    }

    // Projection accuracy — average absolute error for graded picks with projections
    const withProjection = graded.filter(
      p => p.projection?.blended != null && p.actual_value != null
    );
    const avgProjectionError = withProjection.length > 0
      ? Math.round(
          (withProjection.reduce((s, p) => s + Math.abs(p.projection_error || 0), 0)
           / withProjection.length) * 10
        ) / 10
      : null;

    const avgProjectionErrorPct = withProjection.length > 0
      ? Math.round(
          withProjection.reduce((s, p) => s + Math.abs(p.projection_error_pct || 0), 0)
          / withProjection.length
        )
      : null;

    // Recent streak (last 10 graded)
    const recent10 = graded.slice(-10);
    const recentHits = recent10.filter(p => p.hit).length;

    // Most accurate stat (highest hit rate with >= 5 samples)
    const statEntries = Object.entries(byStat).filter(([, d]) => d.total >= 5);
    const bestStat = statEntries.sort((a, b) => (b[1].hitRate || 0) - (a[1].hitRate || 0))[0];
    const worstStat = statEntries.sort((a, b) => (a[1].hitRate || 0) - (b[1].hitRate || 0))[0];

    return res.status(200).json({
      success: true,
      period_days: days,
      summary: {
        total_picks:   all.length,
        graded:        graded.length,
        pending:       all.filter(p => p.status === 'pending').length,
        hits:          hits.length,
        misses:        misses.length,
        hit_rate:      hitRate,
        recent_streak: `${recentHits}/${recent10.length} last 10`,
      },
      by_rating:    byRating,
      by_stat:      byStat,
      by_direction: byDirection,
      projection_accuracy: {
        picks_with_data:      withProjection.length,
        avg_absolute_error:   avgProjectionError,
        avg_error_pct:        avgProjectionErrorPct,
      },
      insights: {
        best_stat:  bestStat  ? { stat: bestStat[0],  hitRate: bestStat[1].hitRate  } : null,
        worst_stat: worstStat ? { stat: worstStat[0], hitRate: worstStat[1].hitRate } : null,
        best_rating: Object.entries(byRating)
          .filter(([, d]) => d.total >= 3)
          .sort((a, b) => (b[1].hitRate || 0) - (a[1].hitRate || 0))[0]?.[0] || null,
      },
    });

  } catch (err) {
    console.error('[halftime/stats] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
