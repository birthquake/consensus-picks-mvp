// FILE LOCATION: api/picks/analyze-pick.js
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getQuickAnalysis } from '../utils/strategy-analyzer.js';
import { analyzeWithClaude } from '../utils/claude-analyzer.js';

let db;
try {
  const adminApp = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
  db = getAdminFirestore(adminApp);
} catch (error) {
  console.log('Firebase Admin already initialized');
  db = getAdminFirestore();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pickId, userId, pickData } = req.body;

  try {
    if (!pickId || !userId || !pickData) {
      return res.status(400).json({ 
        error: 'pickId, userId, and pickData are required' 
      });
    }

    console.log(`[${pickId}] Starting analysis for user ${userId}`);

    // Step 1: Quick analysis (fast)
    const quickAnalysis = getQuickAnalysis(pickData);
    console.log(`[${pickId}] Quick analysis complete`);

    // Step 2: Get user's historical performance
    const userHistory = await getUserPerformance(userId);
    console.log(`[${pickId}] User history retrieved`);

    // Step 3: Claude analysis (intelligent)
    const claudeAnalysis = await analyzeWithClaude(pickData, userHistory, quickAnalysis);
    console.log(`[${pickId}] Claude analysis complete: ${claudeAnalysis.recommendation}`);

    // Step 4: Save to Firestore
    const pickRef = db.collection('users').doc(userId).collection('submitted_picks').doc(pickId);
    
    await pickRef.update({
      analysis: {
        recommendation: claudeAnalysis.recommendation,
        reasoning: claudeAnalysis.reasoning,
        redFlags: claudeAnalysis.redFlags,
        greenFlags: claudeAnalysis.greenFlags,
        legCount: claudeAnalysis.legCount,
        analysisTimestamp: new Date().toISOString()
      },
      status: 'analyzed'
    });

    console.log(`[${pickId}] Analysis saved to Firestore`);

    // Return to frontend
    res.status(200).json({
      success: true,
      pickId,
      analysis: {
        recommendation: claudeAnalysis.recommendation,
        reasoning: claudeAnalysis.reasoning,
        redFlags: claudeAnalysis.redFlags,
        greenFlags: claudeAnalysis.greenFlags,
        legCount: claudeAnalysis.legCount
      }
    });

  } catch (error) {
    console.error(`[${pickId}] Error:`, error);
    res.status(500).json({ 
      error: error.message,
      pickId
    });
  }
}

async function getUserPerformance(userId) {
  try {
    const performanceRef = db.collection('users').doc(userId).collection('performance_stats').doc('overall');
    const doc = await performanceRef.get();
    
    if (doc.exists) {
      return doc.data();
    }
    return null;
  } catch (error) {
    console.log('Could not fetch user performance:', error);
    return null;
  }
}
