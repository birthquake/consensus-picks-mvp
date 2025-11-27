// FILE LOCATION: api/cron/update-user-analytics.js
// Recalculates user analytics after game results are fetched

import { initializeApp, cert, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');

let app;
try {
  app = getApp();
} catch (err) {
  app = initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore(app);

export default async function handler(req, res) {
  // Only allow POST from Vercel cron
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('📊 Starting user analytics update at', new Date().toISOString());

    const usersSnapshot = await db.collection('users').get();
    let totalUsersUpdated = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      
      // Recalculate analytics for this user
      const analytics = await calculateUserAnalytics(userId);
      
      // Update user document if needed
      if (analytics.total_bets > 0) {
        await db.collection('users').doc(userId).update({
          lastAnalyticsUpdate: new Date(),
          currentAnalytics: analytics
        });
        
        totalUsersUpdated++;
        console.log(`✅ Updated analytics for user ${userId}`);
      }
    }

    console.log(`✅ Analytics update complete. Updated: ${totalUsersUpdated} users`);

    return res.status(200).json({
      success: true,
      message: 'User analytics updated',
      usersUpdated: totalUsersUpdated
    });

  } catch (error) {
    console.error('❌ Analytics update error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function calculateUserAnalytics(userId) {
  // Fetch all completed bets for this user
  const betsSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('bets')
    .where('status', '==', 'complete')
    .get();

  const bets = betsSnapshot.docs.map(doc => doc.data());

  if (bets.length === 0) {
    return {
      total_bets: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      total_profit: 0,
      roi: 0,
      by_category: {},
      by_league: {},
      best_category: 'N/A',
      best_rate: 0,
      worst_category: 'N/A',
      worst_rate: 0
    };
  }

  // Count wins and losses
  const wins = bets.filter(b => b.bet_result === 'Won').length;
  const losses = bets.filter(b => b.bet_result === 'Lost').length;
  const win_rate = Math.round((wins / bets.length) * 100);

  // Calculate profit
  const total_profit = bets.reduce((sum, b) => sum + (b.profit_loss || 0), 0);
  const total_wagered = bets.reduce((sum, b) => sum + (b.wager_amount || 0), 0);
  const roi = total_wagered > 0 ? Math.round((total_profit / total_wagered) * 100) : 0;

  // Category breakdown
  const by_category = {};
  const by_league = {};

  bets.forEach(bet => {
    if (bet.picks && Array.isArray(bet.picks)) {
      bet.picks.forEach(pick => {
        const category = `${pick.stat}_${pick.bet_type}`;
        if (!by_category[category]) {
          by_category[category] = { wins: 0, total: 0 };
        }
        by_category[category].total++;
        if (bet.bet_result === 'Won') {
          by_category[category].wins++;
        }

        const league = pick.sport || 'Unknown';
        if (!by_league[league]) {
          by_league[league] = { wins: 0, total: 0 };
        }
        by_league[league].total++;
        if (bet.bet_result === 'Won') {
          by_league[league].wins++;
        }
      });
    }
  });

  // Find best and worst categories
  let best = { category: 'N/A', rate: 0 };
  let worst = { category: 'N/A', rate: 1 };

  Object.entries(by_category).forEach(([category, data]) => {
    const rate = data.total > 0 ? data.wins / data.total : 0;
    if (rate > best.rate && data.total >= 3) {
      best = { category, rate: Math.round(rate * 100) };
    }
    if (rate < worst.rate && data.total >= 3) {
      worst = { category, rate: Math.round(rate * 100) };
    }
  });

  return {
    total_bets: bets.length,
    wins,
    losses,
    win_rate,
    total_profit,
    roi,
    by_category,
    by_league,
    best_category: best.category,
    best_rate: best.rate,
    worst_category: worst.category,
    worst_rate: worst.rate
  };
}
