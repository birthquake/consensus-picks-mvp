// FILE LOCATION: api/cron/fetch-game-results.js
// Daily cron job: Fetch game results via SerpAPI and update bet status

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
const SERPAPI_KEY = process.env.SERPAPI_API_KEY;

export default async function handler(req, res) {
  // Only allow POST from Vercel cron
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🏀 Starting game result fetch at', new Date().toISOString());

    // Get all pending bets across all users
    const usersSnapshot = await db.collection('users').get();
    let totalBetsProcessed = 0;
    let totalBetsUpdated = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      
      // Get pending bets for this user
      const betsSnapshot = await db
        .collection('users')
        .doc(userId)
        .collection('bets')
        .where('status', '==', 'pending_results')
        .get();

      console.log(`📊 Processing ${betsSnapshot.docs.length} pending bets for user ${userId}`);

      for (const betDoc of betsSnapshot.docs) {
        const bet = betDoc.data();
        const betId = betDoc.id;

        try {
          // Process each bet
          const result = await processBet(bet, betId, userId);
          
          if (result.updated) {
            totalBetsUpdated++;
            console.log(`✅ Updated bet ${betId}:`, result.summary);
          } else {
            console.log(`⏳ Bet ${betId} still pending - no clear results found`);
          }
        } catch (error) {
          console.error(`❌ Error processing bet ${betId}:`, error.message);
        }
      }

      totalBetsProcessed += betsSnapshot.docs.length;
    }

    console.log(`✅ Cron job complete. Processed: ${totalBetsProcessed}, Updated: ${totalBetsUpdated}`);

    return res.status(200).json({
      success: true,
      message: 'Game results fetch completed',
      processed: totalBetsProcessed,
      updated: totalBetsUpdated
    });

  } catch (error) {
    console.error('❌ Cron job error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function processBet(bet, betId, userId) {
  const picks = bet.picks || [];
  const outcomes = [];
  let allPicksResolved = true;

  // Process each pick in the bet
  for (const pick of picks) {
    const searchQuery = buildSearchQuery(pick, bet.created_at);
    console.log(`🔍 Searching for: "${searchQuery}"`);

    try {
      const result = await searchGameResult(searchQuery, pick);
      
      if (result.resolved) {
        outcomes.push({
          player: pick.player,
          stat: pick.stat,
          bet_type: pick.bet_type,
          line: pick.line,
          final_value: result.finalValue,
          result: result.won ? 'Won' : 'Lost',
          search_source: result.source
        });
      } else {
        allPicksResolved = false;
        console.log(`⏳ Could not resolve: ${pick.player} - ${pick.stat}`);
      }
    } catch (error) {
      allPicksResolved = false;
      console.error(`❌ Search error for ${pick.player}:`, error.message);
    }
  }

  // Only update if all picks were resolved
  if (!allPicksResolved || outcomes.length !== picks.length) {
    return { updated: false };
  }

  // Determine overall bet result (all picks must hit for parlay)
  const allWon = outcomes.every(o => o.result === 'Won');
  const anyLost = outcomes.some(o => o.result === 'Lost');
  
  const betResult = allWon ? 'Won' : 'Lost';
  const profitLoss = calculateProfitLoss(bet, betResult);

  // Update Firestore
  await db
    .collection('users')
    .doc(userId)
    .collection('bets')
    .doc(betId)
    .update({
      status: 'complete',
      outcomes: outcomes,
      profit_loss: profitLoss,
      completed_at: new Date(),
      bet_result: betResult
    });

  return {
    updated: true,
    summary: `${betResult} ${profitLoss >= 0 ? '+' : ''}$${profitLoss}`
  };
}

function buildSearchQuery(pick, createdAt) {
  // Format date from created_at
  const date = new Date(createdAt);
  const monthName = date.toLocaleString('en-US', { month: 'long' });
  const day = date.getDate();

  // Build search: "Player Stat Sport Month Day"
  return `${pick.player} ${pick.stat} ${pick.sport} ${monthName} ${day}`;
}

async function searchGameResult(query, pick) {
  const params = {
    q: query,
    api_key: SERPAPI_KEY,
    gl: 'us',
    hl: 'en'
  };

  const queryString = new URLSearchParams(params).toString();
  const response = await fetch(`https://serpapi.com/search?${queryString}`);
  const data = await response.json();

  // Extract relevant information from SerpAPI results
  const result = parseSearchResults(data, pick);
  
  return result;
}

function parseSearchResults(serpResults, pick) {
  // Look through organic results for stat values
  const organicResults = serpResults.organic_results || [];
  
  for (const result of organicResults) {
    const text = (result.snippet || '') + ' ' + (result.title || '');
    const lowerText = text.toLowerCase();
    
    // Try to extract the stat value
    const value = extractStatValue(text, pick.stat);
    
    if (value !== null) {
      const won = determineWin(value, pick.line, pick.bet_type);
      
      return {
        resolved: true,
        finalValue: value,
        won: won,
        source: result.source || 'sports_site'
      };
    }
  }

  // If no clear result found
  return {
    resolved: false,
    finalValue: null,
    won: false,
    source: 'unknown'
  };
}

function extractStatValue(text, stat) {
  // Common patterns for different stats
  const patterns = {
    'passing yards': /(\d+)\s*(?:passing yards?|pass yards?)/i,
    'receiving yards': /(\d+)\s*(?:receiving yards?|rec yards?)/i,
    'rushing yards': /(\d+)\s*(?:rushing yards?|rush yards?)/i,
    'points': /(\d+)\s*(?:points?|pts?)\b/i,
    'rebounds': /(\d+)\s*(?:rebounds?|rebs?|boards?)/i,
    'assists': /(\d+)\s*(?:assists?|asst?)/i,
    'passing touchdowns': /(\d+)\s*(?:passing touchdowns?|pass tds?)/i,
    'touchdowns': /(\d+)\s*(?:touchdowns?|tds?)/i,
    'interceptions': /(\d+)\s*(?:interceptions?|ints?)/i,
    'three pointers': /(\d+)\s*(?:three pointers?|three-pointers?|3ps?)/i
  };

  const statLower = stat.toLowerCase();
  const pattern = patterns[statLower];

  if (pattern) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

function determineWin(finalValue, line, betType) {
  if (betType === 'Over' || betType === 'over') {
    return finalValue > line;
  } else if (betType === 'Under' || betType === 'under') {
    return finalValue < line;
  } else if (betType === 'Moneyline' || betType === 'moneyline') {
    // For moneyline, we'd need game result
    // Assume if value exists and > 0, it's a win
    return finalValue > 0;
  }

  return false;
}

function calculateProfitLoss(bet, betResult) {
  if (betResult === 'Won') {
    // For simplicity: if it's a parlay with multiple legs, use potential_payout
    // Otherwise, calculate based on odds
    if (bet.parlay_legs && bet.parlay_legs > 1) {
      // Parlay: profit is potential_payout - wager
      return (bet.potential_payout || 0) - (bet.wager_amount || 0);
    } else {
      // Single bet: calculate from odds
      const odds = bet.picks[0]?.odds || -110;
      const wager = bet.wager_amount || 0;
      
      if (odds > 0) {
        return (wager / 100) * odds;
      } else {
        return wager / (Math.abs(odds) / 100);
      }
    }
  } else {
    // Lost: loss is the wager amount
    return -(bet.wager_amount || 0);
  }
}
