// FILE LOCATION: api/picks/get-picks.js

import { getFirestoreAdmin } from '../utils/firebase-admin.js';

function formatPickForFrontend(pick) {
  return {
    id: pick.id,
    sport: pick.sport,
    pick: pick.adjustedPick || pick.pick,
    originalPick: pick.pick,
    consensusStrength: pick.consensusStrength,
    confidenceScore: Math.round(pick.confidenceScore * 100),
    pickType: pick.pickType,
    firstSeen: pick.firstSeen,
    lastUpdated: pick.lastUpdated,
    pickStatus: pick.pickStatus,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { sport, minConsensus = 2, limit = 50 } = req.query;

    const db = getFirestoreAdmin();
    
    let query = db.collection('picks').where('pickStatus', '==', 'pending');

    if (sport && sport !== 'all') {
      query = query.where('sport', '==', sport);
    }

    query = query.where('consensusStrength', '>=', parseInt(minConsensus));
    query = query.orderBy('consensusStrength', 'desc').orderBy('confidenceScore', 'desc');
    query = query.limit(parseInt(limit));

    const snapshot = await query.get();
    const picks = [];

    snapshot.forEach(doc => {
      const pickData = { id: doc.id, ...doc.data() };
      picks.push(formatPickForFrontend(pickData));
    });

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      count: picks.length,
      picks,
    });
  } catch (error) {
    console.error('Error fetching picks:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
