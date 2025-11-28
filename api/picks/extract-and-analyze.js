// FILE LOCATION: api/extract-and-analyze.js
// Extracts picks and game date from bet slip image using Claude Vision + generates personalized analysis

import Anthropic from '@anthropic-ai/sdk';
import { initializeApp, cert, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const client = new Anthropic();

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, imageBase64, imageName } = req.body;

    if (!userId || !imageBase64) {
      return res.status(400).json({ error: 'Missing userId or imageBase64' });
    }

    console.log(`📸 Processing bet slip for user ${userId}`);

    // Step 1: Extract picks from image using Claude Vision
    const extractionResult = await extractPicksFromImage(imageBase64);
    
    if (!extractionResult.success) {
      return res.status(400).json({ error: extractionResult.error });
    }

    const { picks, sportsbook, wager_amount, potential_payout, game_date } = extractionResult;

    console.log(`✅ Extracted ${picks.length} picks from image`);
    console.log(`📅 Game date: ${game_date}`);

    // Step 2: Generate personalized analysis using Claude
    const analysis = await generateAnalysis(picks);

    console.log(`📝 Generated personalized analysis`);

    // Step 3: Store in Firestore
    const betData = {
      picks: picks,
      sportsbook: sportsbook,
      wager_amount: wager_amount,
      potential_payout: potential_payout,
      game_date: new Date(game_date), // Store as Date object
      analysis: analysis,
      status: 'pending_results',
      parlay_legs: picks.length,
      created_at: new Date(),
      image_name: imageName,
      user_analytics_snapshot: {
        total_bets: 0,
        wins: 0,
        losses: 0,
        win_rate: 0,
        roi: 0,
        best_category: 'N/A',
        best_rate: 0,
        worst_category: 'N/A',
        worst_rate: 0
      }
    };

    const betRef = await db
      .collection('users')
      .doc(userId)
      .collection('bets')
      .add(betData);

    console.log(`✅ Stored bet ${betRef.id} in Firestore`);

    return res.status(200).json({
      success: true,
      betId: betRef.id,
      picks: picks,
      analysis: analysis,
      gameDate: game_date
    });

  } catch (error) {
    console.error('Error processing bet slip:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function extractPicksFromImage(imageBase64) {
  try {
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: `You are a sports betting expert analyzing a bet slip image. Extract the following information and return it as valid JSON (no markdown, just raw JSON):

{
  "sportsbook": "name of the sportsbook (DraftKings, FanDuel, etc.)",
  "game_date": "YYYY-MM-DD format - the date the game is being played",
  "wager_amount": number,
  "potential_payout": number or null,
  "picks": [
    {
      "player": "player name",
      "sport": "NFL, NBA, MLB, etc.",
      "stat": "passing yards, points, rebounds, etc.",
      "bet_type": "Over or Under or Moneyline or Spread",
      "line": number,
      "odds": number
    }
  ]
}

IMPORTANT:
- game_date MUST be the date of the actual game/event, NOT the date the bet was placed
- If you see a specific date on the slip (like "Nov 27" or "11/27/25"), use that
- If no explicit date, infer from context clues (e.g., "Tonight", "Tomorrow")
- Always format game_date as YYYY-MM-DD
- For wager_amount and potential_payout, extract numbers only
- For odds, include the +/- sign if present
- Return ONLY valid JSON, nothing else`
            }
          ]
        }
      ]
    });

    const content = response.content[0].text;
    
    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse Claude response as JSON');
    }

    const extractedData = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!extractedData.picks || !Array.isArray(extractedData.picks) || extractedData.picks.length === 0) {
      throw new Error('No picks found in bet slip');
    }

    if (!extractedData.game_date) {
      throw new Error('Could not determine game date from bet slip');
    }

    // Validate game_date format
    const gameDate = new Date(extractedData.game_date);
    if (isNaN(gameDate.getTime())) {
      throw new Error(`Invalid game_date format: ${extractedData.game_date}`);
    }

    return {
      success: true,
      picks: extractedData.picks,
      sportsbook: extractedData.sportsbook || 'Unknown',
      wager_amount: extractedData.wager_amount || 0,
      potential_payout: extractedData.potential_payout || 0,
      game_date: extractedData.game_date
    };

  } catch (error) {
    console.error('Error extracting picks:', error);
    return {
      success: false,
      error: `Failed to extract picks: ${error.message}`
    };
  }
}

async function generateAnalysis(picks) {
  try {
    const picksSummary = picks
      .map(p => `${p.player} ${p.stat} ${p.bet_type} ${p.line}`)
      .join('\n');

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 3000,
      messages: [
        {
          role: 'user',
          content: `You are a professional sports betting analyst. Analyze this ${picks.length}-leg parlay and provide personalized insights:

${picksSummary}

Provide a detailed analysis in markdown format covering:
1. Overall assessment and confidence level
2. Key observations about each pick
3. Risk factors and correlations
4. Specific recommendations for this bettor
5. Confidence rating

Be honest about the difficulty of hitting ${picks.length}-leg parlays while being constructive. Format with proper markdown headers and emphasis.`
        }
      ]
    });

    return response.content[0].text;

  } catch (error) {
    console.error('Error generating analysis:', error);
    return 'Could not generate analysis at this time.';
  }
}
