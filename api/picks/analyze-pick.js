// FILE LOCATION: api/picks/analyze-pick.js
import { getFirestore, collection, doc, updateDoc } from 'firebase/firestore';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import analyzeSubmittedPick from '../utils/strategy-analyzer.js';

// Initialize Firebase Admin
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

    // Run analysis
    const analysis = analyzeSubmittedPick(pickData);

    // Save analysis to Firestore
    const pickRef = doc(db, 'users', userId, 'submitted_picks', pickId);
    
    await updateDoc(pickRef, {
      analysis: {
        recommendation: analysis.recommendation,
        overallConfidence: analysis.overallConfidence,
        expectedHitRate: analysis.expectedHitRate,
        estimatedROI: analysis.estimatedROI,
        legAnalysis: analysis.legAnalysis,
        removedLegs: analysis.removedLegs,
        suggestedAdditions: analysis.suggestedAdditions,
        refinedOdds: analysis.refinedOdds,
        refinedLegCount: analysis.refinedLegCount,
        issues: analysis.issues,
        warnings: analysis.warnings,
        strengths: analysis.strengths,
        analysisTimestamp: new Date().toISOString()
      },
      status: 'analyzed'
    });

    // Return analysis to frontend
    res.status(200).json({
      success: true,
      pickId,
      analysis,
      message: 'Pick analyzed successfully'
    });
  } catch (error) {
    console.error('Error analyzing pick:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to analyze pick'
    });
  }
}
