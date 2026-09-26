// FILE LOCATION: api/halftime/picks.js
// Combined pick storage + stats (merged from api/halftime/save-picks.js and
// api/halftime/stats.js to save a Vercel function slot — Hobby plan caps at 12).
// Dispatches on HTTP method, same as each file did on its own before the merge:
//   POST -> save Claude's recommendations to Firestore (or mark_twitter action)
//   GET  -> aggregate accuracy metrics for the UI
//
// Usage:
//   POST /api/halftime/picks
//   Body: { gameId, sport, league, gameName, gameDate, picks, projections }
//   POST /api/halftime/picks { action: 'mark_twitter', pickIds: [...] }
//   GET  /api/halftime/picks?days=30

import { initializeApp, cert, getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');

let app;
try { app = getApp(); } catch {
  app = initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore(app);

// ─── POST: save picks ──────────────────────────────────────────────────────

async function handleSave(req, res) {
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
      console.log(`[halftime/picks] Marked ${pickIds.length} picks as posted to Twitter`);
      return res.status(200).json({ success: true, marked: pickIds.length });
    } catch (err) {
      console.error('[halftime/picks] mark_twitter error:', err.message);
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

    console.log(`[halftime/picks] Saved ${savedIds.length}, skipped ${skipped} duplicates for game ${gameId}`);

    return res.status(200).json({
      success: true,
      saved: savedIds.length,
      skipped,
      ids: savedIds,
      // Return key→id map so UI can mark specific picks as Twitter posts
      pick_ids: savedKeys,
    });

  } catch (err) {
    console.error('[halftime/picks] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── GET: stats ─────────────────────────────────────────────────────────────

async function handleStats(req, res) {
  // TEMP DEBUG — sample raw pending picks to diagnose why grading is stuck.
  // Remove once the stuck-backlog investigation is done.
  if (req.query.debug === 'true') {
    try {
      const snap = await db.collection('halftime_picks').where('status', '==', 'pending').limit(15).get();
      const sample = snap.docs.map(d => {
        const p = d.data();
        return {
          id: d.id, player: p.player, stat: p.stat, sport: p.sport, league: p.league,
          gameId: p.gameId, gameDate: p.gameDate, direction: p.direction,
          created_at: p.created_at?.toDate?.() ?? p.created_at ?? null,
        };
      });
      return res.status(200).json({ success: true, sample_count: sample.length, sample });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
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

    // ── Twitter picks — separate hit rate tracking ────────────────────────
    const twitterGraded  = graded.filter(p => p.posted_to_twitter === true);
    const twitterHits    = twitterGraded.filter(p => p.hit === true);
    const twitterPending = all.filter(p => p.posted_to_twitter === true && p.status === 'pending');

    const twitterHitRate = twitterGraded.length > 0
      ? Math.round((twitterHits.length / twitterGraded.length) * 100)
      : null;

    // Projection accuracy
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
    const recent10   = graded.slice(-10);
    const recentHits = recent10.filter(p => p.hit).length;

    // Most accurate stat (highest hit rate with >= 5 samples)
    const statEntries = Object.entries(byStat).filter(([, d]) => d.total >= 5);
    const bestStat  = statEntries.sort((a, b) => (b[1].hitRate || 0) - (a[1].hitRate || 0))[0];
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
      // ── Twitter picks performance ────────────────────────────────────────
      twitter: {
        graded:   twitterGraded.length,
        hits:     twitterHits.length,
        pending:  twitterPending.length,
        hit_rate: twitterHitRate,
      },
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
    console.error('[halftime/picks] Stats error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'POST') return handleSave(req, res);
  if (req.method === 'GET')  return handleStats(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
