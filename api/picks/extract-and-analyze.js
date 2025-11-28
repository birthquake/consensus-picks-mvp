// FILE LOCATION: api/picks/extract-and-analyze.js
// SIMPLIFIED: Takes base64 image, extracts picks + analyzes with user history in ONE call
// No Firebase Storage - only stores extracted data

import { Anthropic } from ‘@anthropic-ai/sdk’;
import { initializeApp, cert, getApp } from ‘firebase-admin/app’;
import { getFirestore } from ‘firebase-admin/firestore’;

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || ‘{}’);

let app;
try {
// Try to get existing app first
app = getApp();
} catch (err) {
// App doesn’t exist, initialize it
app = initializeApp({
credential: cert(serviceAccount)
});
}

const db = getFirestore(app);
const anthropic = new Anthropic({
apiKey: process.env.ANTHROPIC_API_KEY
});

export default async function handler(req, res) {
if (req.method !== ‘POST’) {
return res.status(405).json({ error: ‘Method not allowed’ });
}

const { userId, imageBase64, imageMediaType } = req.body;

try {
if (!userId || !imageBase64) {
return res.status(400).json({
success: false,
error: ‘Missing required fields: userId, imageBase64’
});
}

```
console.log(`🔍 Extracting picks from image for user ${userId}`);

// Step 1: Extract picks from image using Claude vision
const extractionMessage = await anthropic.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 3000,  // ← Increased from 1024 to handle large parlays
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: imageMediaType || 'image/jpeg',
            data: imageBase64
          }
        },
        {
          type: 'text',
          text: `Analyze this sports bet slip screenshot and extract all the picks/bets visible. Return ONLY valid JSON (no markdown, no extra text).
```

For each pick/bet line you see, extract:

- player: Player or team name
- stat: The stat being bet on (e.g., “Passing Yards”, “Receiving Yards”, “Points”, “Spread”, “Moneyline”, etc.)
- bet_type: Type of bet - “Over”, “Under”, “Moneyline”, “Spread”, or the direction if visible
- line: The number/line for the bet (if visible as a number)
- odds: The odds shown (e.g., -110, +150)
- sport: Sport (NFL, NBA, NHL, MLB, College Football, etc.) - infer if not obvious

Also identify:

- sportsbook: Which sportsbook (DraftKings, FanDuel, BetMGM, Draftkings, etc.)
- parlay_legs: Number of legs if it’s a parlay (or number of picks)
- potential_payout: The payout amount shown (look for “to win” or total payout)
- wager_amount: The amount wagered/bet

IMPORTANT: Be flexible with what counts as a pick. Accept any bet shown on the slip.
If any field is not visible or unclear, use null.

Return JSON format:
{
“sportsbook”: “DraftKings”,
“parlay_legs”: 3,
“wager_amount”: 50,
“potential_payout”: 420,
“picks”: [
{
“player”: “Patrick Mahomes”,
“stat”: “Passing Yards”,
“bet_type”: “Over”,
“line”: 280,
“odds”: -110,
“sport”: “NFL”
}
]
}

If you cannot extract ANY valid picks from this image, return:
{
“error”: “Could not extract picks from this image”
}

Try your best to extract what you can see, even if some fields are unclear.`
}
]
}
]
});

```
// Parse extracted data
let extractedData;
try {
  let responseText = extractionMessage.content[0].text;
  console.log('🔍 Claude raw response (first 500 chars):', responseText.substring(0, 500));
  console.log('🔍 Claude response length:', responseText.length);
  
  // Try multiple cleanup approaches
  let jsonText = responseText
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  
  // If still has markdown, try more aggressive cleaning
  if (jsonText.includes('```')) {
    jsonText = jsonText.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');
  }
  
  console.log('📝 Cleaned JSON (first 500 chars):', jsonText.substring(0, 500));
  console.log('📝 Cleaned JSON length:', jsonText.length);
  
  extractedData = JSON.parse(jsonText);
  console.log('✅ Parsed extraction data:', JSON.stringify(extractedData).substring(0, 200));
} catch (parseError) {
  console.error('❌ Failed to parse extraction:', parseError.message);
  console.error('❌ Error at position:', parseError.message.match(/position (\d+)/)?.[1]);
  console.error('Response text was:', extractionMessage.content[0].text.substring(0, 1000));
  return res.status(400).json({
    success: false,
    error: 'Could not parse picks from image. Please ensure it\'s a clear bet slip screenshot.'
  });
}

if (extractedData.error) {
  console.warn('⚠️ Extraction error:', extractedData.error);
  return res.status(400).json({
    success: false,
    error: extractedData.error
  });
}

if (!extractedData.picks || extractedData.picks.length === 0) {
  return res.status(400).json({
    success: false,
    error: 'No picks found in the image'
  });
}

console.log(`✅ Extracted ${extractedData.picks.length} picks`);

// Step 2: Fetch user's past bets for context
const betsSnapshot = await db
  .collection('users')
  .doc(userId)
  .collection('bets')
  .where('status', '==', 'complete')
  .limit(50)
  .get();

const analytics = calculateAnalytics(betsSnapshot.docs);
const userContext = buildUserContext(analytics);

console.log(`📈 User stats - Bets: ${analytics.total_bets}, Win Rate: ${analytics.win_rate}%`);

// Step 3: Analyze picks with user history context
const analysisMessage = await anthropic.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 1500,
  messages: [
    {
      role: 'user',
      content: `You are an expert sports betting analyst. Analyze this user's new bet slip and provide personalized refinement analysis.
```

${userContext}

NEW BETS TO ANALYZE:
${formatPicksForAnalysis(extractedData.picks)}

Provide personalized analysis that:

1. Acknowledges how these picks fit their historical style
1. Highlights their strengths (e.g., “Your QB passing props hit 73%”)
1. Warns about weak areas (e.g., “You’re 0-4 on rushing bets”)
1. Gives specific confidence level (High/Medium/Low)
1. Suggests any adjustments based on their pattern
1. Validates picks against their hit rate by category

Be encouraging but honest. Reference their specific numbers when possible. Keep it concise (2-3 paragraphs).`
}
]
});

```
const analysis = analysisMessage.content[0].text;
console.log(`✅ Analysis generated`);

// Step 4: Store in Firestore (no image storage)
const betDocRef = await db.collection('users').doc(userId).collection('bets').add({
  // Extracted data
  picks: extractedData.picks,
  sportsbook: extractedData.sportsbook || 'Unknown',
  parlay_legs: extractedData.parlay_legs || null,
  wager_amount: extractedData.wager_amount || null,
  potential_payout: extractedData.potential_payout || null,
  
  // Analysis
  analysis: analysis,
  user_analytics_snapshot: analytics,
  
  // Status tracking
  status: 'pending_results',
  created_at: new Date(),
  analyzed_at: new Date(),
  
  // Results (filled in later by cron job)
  outcomes: null,
  profit_loss: null,
  completed_at: null
});

console.log(`📝 Bet saved to Firestore: ${betDocRef.id}`);

return res.status(200).json({
  success: true,
  betId: betDocRef.id,
  sportsbook: extractedData.sportsbook,
  picks: extractedData.picks,
  parlay_legs: extractedData.parlay_legs,
  wager_amount: extractedData.wager_amount,
  potential_payout: extractedData.potential_payout,
  analysis: analysis,
  user_stats: {
    total_bets: analytics.total_bets,
    win_rate: analytics.win_rate,
    roi: analytics.roi
  }
});
```

} catch (error) {
console.error(‘❌ Error:’, error);
return res.status(500).json({
success: false,
error: error.message || ‘Failed to process bet slip’
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
best_category: ‘N/A’,
worst_category: ‘N/A’
};
}

// Count completed bets
const wins = bets.filter(b => b.profit_loss > 0).length;
const losses = bets.filter(b => b.profit_loss <= 0).length;
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
if (bet.profit_loss > 0) {
by_category[category].wins++;
}

```
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
```

});

// Find best/worst
let best = { category: ‘N/A’, rate: 0 };
let worst = { category: ‘N/A’, rate: 1 };

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

function buildUserContext(analytics) {
if (analytics.total_bets === 0) {
return ‘USER PROFILE: This is a new user with no betting history yet. Provide general advice.’;
}

let context = `USER PROFILE:

- Total Bets: ${analytics.total_bets}
- Overall Win Rate: ${analytics.win_rate}%
- Total Profit/Loss: $${analytics.total_profit > 0 ? ‘+’ : ‘’}${analytics.total_profit}
- ROI: ${analytics.roi}%`;
  
  if (analytics.best_category !== ‘N/A’) {
  context += `\n- Best Category: ${analytics.best_category} (${analytics.best_rate}% hit rate)`;
  }
  if (analytics.worst_category !== ‘N/A’) {
  context += `\n- Worst Category: ${analytics.worst_category} (${analytics.worst_rate}% hit rate)`;
  }
  
  const leagues = Object.entries(analytics.by_league)
  .map(([league, data]) => {
  const rate = data.total > 0 ? Math.round((data.wins / data.total) * 100) : 0;
  return `${league}: ${rate}%`;
  })
  .join(’, ’);
  
  if (leagues) {
  context += `\n- By League: ${leagues}`;
  }
  
  context += ‘\n\nUse this data to provide PERSONALIZED feedback.’;
  return context;
  }

function formatPicksForAnalysis(picks) {
return picks.map((pick, idx) =>
`${idx + 1}. ${pick.player} - ${pick.stat} ${pick.bet_type} ${pick.line} (${pick.odds})`
).join(’\n’);
}