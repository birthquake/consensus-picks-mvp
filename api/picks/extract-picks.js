// FILE LOCATION: api/picks/extract-picks.js
// Uses Claude vision to extract picks from bet slip screenshot

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

  const { userId, betId, imageUrl } = req.body;

  try {
    if (!userId || !betId || !imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, betId, imageUrl'
      });
    }

    console.log(`🔍 Extracting picks from image for bet ${betId}`);

    // Call Claude vision to extract picks
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-1-20250805',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'url',
                url: imageUrl
              }
            },
            {
              type: 'text',
              text: `Analyze this sports bet slip screenshot and extract all the picks/bets. Return ONLY valid JSON (no markdown, no extra text).

For each pick, extract:
- player: Player name (string)
- stat: Stat name (e.g., "Passing Yards", "Receiving Yards", "Points")
- bet_type: Type of bet - "Over", "Under", "Moneyline", "Spread", "Parlay Leg", etc.
- line: The number line (e.g., 280 for Over 280) (number)
- odds: The odds (e.g., -110) (number)
- sport: Sport (NFL, NBA, NHL, MLB, etc.) (string)

Also identify:
- sportsbook: Which sportsbook (DraftKings, FanDuel, BetMGM, etc.)
- parlay_legs: Number of legs if it's a parlay (number or null)
- potential_payout: The payout shown (number or null)
- wager_amount: The wager amount shown (number or null)

Return JSON format:
{
  "sportsbook": "DraftKings",
  "parlay_legs": 3,
  "wager_amount": 50,
  "potential_payout": 420,
  "picks": [
    {
      "player": "Patrick Mahomes",
      "stat": "Passing Yards",
      "bet_type": "Over",
      "line": 280,
      "odds": -110,
      "sport": "NFL"
    }
  ]
}

If you cannot extract valid picks or the image doesn't show a bet slip, return:
{
  "error": "Could not extract picks from this image"
}`
            }
          ]
        }
      ]
    });

    // Parse Claude's response
    let extractedData;
    try {
      const responseText = message.content[0].text;
      // Remove markdown code blocks if present
      const jsonText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      extractedData = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('❌ Failed to parse Claude response:', parseError);
      return res.status(400).json({
        success: false,
        error: 'Could not parse picks from image. Please ensure it\'s a clear bet slip screenshot.'
      });
    }

    // Check if Claude found an error
    if (extractedData.error) {
      console.warn('⚠️ Claude could not extract picks:', extractedData.error);
      return res.status(400).json({
        success: false,
        error: extractedData.error
      });
    }

    // Validate extracted data
    if (!extractedData.picks || extractedData.picks.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No picks found in the image'
      });
    }

    console.log(`✅ Extracted ${extractedData.picks.length} picks`);

    // Update Firestore document with extracted picks
    await db.collection('users').doc(userId).collection('bets').doc(betId).update({
      picks: extractedData.picks,
      sportsbook: extractedData.sportsbook || 'Unknown',
      parlay_legs: extractedData.parlay_legs || null,
      wager_amount: extractedData.wager_amount || null,
      potential_payout: extractedData.potential_payout || null,
      status: 'analyzing',
      picks_extracted_at: new Date()
    });

    console.log(`📝 Updated Firestore with extracted picks`);

    return res.status(200).json({
      success: true,
      betId,
      sportsbook: extractedData.sportsbook,
      picks: extractedData.picks,
      parlay_legs: extractedData.parlay_legs,
      wager_amount: extractedData.wager_amount,
      potential_payout: extractedData.potential_payout
    });

  } catch (error) {
    console.error('❌ Error extracting picks:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to extract picks from image'
    });
  }
}
