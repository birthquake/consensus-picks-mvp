// FILE LOCATION: api/picks/analyze-with-history.js
// Fetches user's betting history and gives personalized analysis with Claude

import { Anthropic } from '@anthropic-ai/sdk';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');

let app;
try {
  app = initializeApp({
    credential: cert(serviceAccount)
  });
} catch (err) {
  // App already initialized
  app = require('firebase-admin/app').getApp();
}

const db = getFirestore(app);
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, betId, picks, imageBase64 } = req.body;

  try {
    if (!userId || !betId || !picks) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    console.log(`📊 Analyzing picks with user history for ${userId}`);

    // Fetch user's past bets (completed ones only)
    const betsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('bets')
      .where('status', '==', 'complete')
      .limit(50)
      .get();

    // Calculate user analytics
    const analytics = calculateAnalytics(betsSnapshot.docs);

    console.log(`📈 User stats - Win Rate: ${analytics.win_rate}%, ROI: ${analytics.roi}%`);

    // Build user history context
    const userContext = buildUserContext(analytics);

    // Call Claude with image + history
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-1-20250805',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            ...(imageBase64 ? [{
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageBase64
              }
            }] : []),
            {
              type: 'text',
              text: `You are an expert sports betting analyst. Analyze this user's bet slip and provide personalized refinement analysis.

${userContext}

NEW BETS TO ANALYZE:
${formatPicksForAnalysis(picks)}

Provide personalized analysis that:
1. Acknowledges how these picks fit their historical style
2. Highlights their strengths (e.g., "Your QB passing props hit 73%")
3. Warns about weak areas (e.g., "You're 0-4 on rushing bets")
4. Gives specific confidence level (High/Medium/Low)
5. Suggests any adjustments based on their pattern
6. Validates picks against their hit rate by category

Be encouraging but honest. Reference their specific numbers when possible.`
            }
          ]
        }
      ]
    });

    const analysis = message.content[0].text;

    console.log(`✅ Analysis generated`);

    // Store analysis in Firestore
    const analysisRef = await db
      .collection('users')
      .doc(userId)
      .collection('pick_analyses')
      .add({
        bet_id: betId,
        analysis_text: analysis,
        picks_analyzed: picks,
        user_analytics_snapshot: analytics,
        created_at: new Date(),
        status: 'pending_results'
      });

    // Update bet status to "pending_results"
    await db
      .collection('users')
      .doc(userId)
      .collection('bets')
      .doc(betId)
      .update({
        status: 'pending_results',
        analysis_id: analysisRef.id,
        analyzed_at: new Date()
      });

    console.log(`📝 Analysis stored with ID: ${analysisRef.id}`);

    return res.status(200).json({
      success: true,
      betId,
      analysis_id: analysisRef.id,
      analysis,
      user_stats: {
        total_bets: analytics.total_bets,
        win_rate: analytics.win_rate,
        roi: analytics.roi,
        best_category: analytics.best_category,
        worst_category: analytics.worst_category
      }
    });

  } catch (error) {
    console.error('❌ Error analyzing picks:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to analyze picks'
    });
  }
}

function calculateAnalytics(docs) {
  const bets = docs.map(doc => doc.data());
  
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
      worst_category: 'N/A'
    };
  }

  // Basic stats
  const completedBets = bets.filter(b => b.outcomes && b.outcomes.length > 0);
  const wins = completedBets.filter(b => 
    b.outcomes && b.outcomes.every(o => o.result === 'Won')
  ).length;
  const losses = completedBets.length - wins;
  const win_rate = Math.round((wins / completedBets.length) * 100);

  // Calculate profit/loss
  const total_profit = completedBets.reduce((sum, b) => sum + (b.profit_loss || 0), 0);
  const total_wagered = completedBets.reduce((sum, b) => sum + (b.wager_amount || 0), 0);
  const roi = total_wagered > 0 ? Math.round((total_profit / total_wagered) * 100) : 0;

  // Category breakdown
  const by_category = {};
  const by_league = {};

  completedBets.forEach(bet => {
    if (bet.picks && Array.isArray(bet.picks)) {
      bet.picks.forEach(pick => {
        const category = `${pick.stat}_${pick.bet_type}`;
        if (!by_category[category]) {
          by_category[category] = { wins: 0, total: 0 };
        }
        by_category[category].total++;
        if (bet.profit_loss > 0) {
          by_category[category].wins++;
        }
      });
    }

    // League breakdown
    if (bet.picks && Array.isArray(bet.picks)) {
      bet.picks.forEach(pick => {
        const league = pick.sport || 'Unknown';
        if (!by_league[league]) {
          by_league[league] = { wins: 0, total: 0 };
        }
        by_league[league].total++;
        if (bet.profit_loss > 0) {
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
    if (rate > best.rate && data.total >= 3) { // Need at least 3 bets
      best = { category, rate: Math.round(rate * 100) };
    }
    if (rate < worst.rate && data.total >= 3) {
      worst = { category, rate: Math.round(rate * 100) };
    }
  });

  return {
    total_bets: completedBets.length,
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

function buildUserContext(analytics) {
  if (analytics.total_bets === 0) {
    return 'USER PROFILE: This is a new user with no betting history yet.';
  }

  let context = `USER PROFILE:
- Total Bets: ${analytics.total_bets}
- Overall Win Rate: ${analytics.win_rate}%
- Total Profit/Loss: $${analytics.total_profit > 0 ? '+' : ''}${analytics.total_profit}
- ROI: ${analytics.roi}%`;

  if (analytics.best_category !== 'N/A') {
    context += `\n- Best Category: ${analytics.best_category} (${analytics.best_rate}% hit rate)`;
  }
  if (analytics.worst_category !== 'N/A') {
    context += `\n- Worst Category: ${analytics.worst_category} (${analytics.worst_rate}% hit rate)`;
  }

  // League breakdown
  const leagues = Object.entries(analytics.by_league)
    .map(([league, data]) => {
      const rate = data.total > 0 ? Math.round((data.wins / data.total) * 100) : 0;
      return `${league}: ${rate}%`;
    })
    .join(', ');
  
  if (leagues) {
    context += `\n- By League: ${leagues}`;
  }

  context += '\n\nUse this data to provide PERSONALIZED feedback.';
  return context;
}

function formatPicksForAnalysis(picks) {
  return picks.map((pick, idx) => 
    `${idx + 1}. ${pick.player} - ${pick.stat} ${pick.bet_type} ${pick.line} (${pick.odds})`
  ).join('\n');
}
