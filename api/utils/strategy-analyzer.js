// FILE LOCATION: api/utils/strategy-analyzer.js

// Blacklisted players (historically 0% hit rate)
const BLACKLIST = {
  'Franz Wagner': { reason: '0-4 record on 20+/18+', minThreshold: 15 },
  'Brandon Ingram': { reason: '0-3 record on 15+/18+', minThreshold: 12 },
  'RJ Barrett': { reason: '0-2 record', minThreshold: 10 },
  'Anthony Edwards': { reason: '0-2 record on 35+', minThreshold: 30 },
  'Nikola Jokic': { reason: '0-2 record on 30+', minThreshold: 28 }
};

// Players with strong historical hit rates
const STRONG_PLAYERS = {
  'Travis Kelce': { hitRate: 1.0, avgOver: 5, confidence: 'VERY HIGH' },
  'Patrick Mahomes': { hitRate: 0.87, avgOver: 35, confidence: 'HIGH' },
  'Tyreek Hill': { hitRate: 0.85, avgOver: 15, confidence: 'HIGH' },
  'Trey Murphy III': { hitRate: 0.75, avgOver: 5, confidence: 'MEDIUM' }
};

export function analyzeSubmittedPick(pickData) {
  const analysis = {
    recommendation: 'PENDING',
    overallConfidence: 0,
    expectedHitRate: 0,
    estimatedROI: 0,
    legAnalysis: [],
    removedLegs: [],
    suggestedAdditions: [],
    refinedOdds: pickData.originalOdds,
    refinedLegCount: pickData.originalLegs.length,
    issues: [],
    warnings: [],
    strengths: []
  };

  // Analyze each leg
  pickData.originalLegs.forEach((leg, index) => {
    const legAnalysis = analyzeLeg(leg, pickData.sport);
    analysis.legAnalysis.push({
      legNumber: index + 1,
      ...legAnalysis
    });
  });

  // Calculate overall parlay metrics
  calculateParlaySmetrics(analysis, pickData);

  // Apply strategy rules
  applyStrategyRules(analysis, pickData);

  // Make final recommendation
  makeRecommendation(analysis);

  return analysis;
}

function analyzeLeg(leg, sport) {
  const analysis = {
    player: leg.player,
    stat: leg.stat,
    threshold: leg.threshold,
    recommendation: 'KEEP',
    strength: 'UNKNOWN',
    score: 0,
    issues: [],
    strengths: [],
    dataPoints: {}
  };

  // Check blacklist
  if (BLACKLIST[leg.player]) {
    analysis.recommendation = 'REMOVE';
    analysis.strength = 'VERY WEAK';
    analysis.score = 5;
    analysis.issues.push(`Blacklisted player: ${BLACKLIST[leg.player].reason}`);
    return analysis;
  }

  // Check if player is in strong players list
  if (STRONG_PLAYERS[leg.player]) {
    const playerData = STRONG_PLAYERS[leg.player];
    analysis.strengths.push(`Strong historical record: ${(playerData.hitRate * 100).toFixed(0)}% hit rate`);
    analysis.strengths.push(`Confidence: ${playerData.confidence}`);
  }

  // Analyze threshold vs average
  const thresholdNum = parseInt(leg.threshold);
  const mockAverage = getMockPlayerAverage(leg.player, leg.stat);
  
  analysis.dataPoints.playerAverage = mockAverage;
  analysis.dataPoints.threshold = thresholdNum;
  analysis.dataPoints.buffer = mockAverage - thresholdNum;

  // Score based on threshold difficulty
  if (mockAverage > thresholdNum + 15) {
    analysis.score = 90;
    analysis.strength = 'VERY STRONG';
    analysis.strengths.push(`High confidence: Player averages ${mockAverage}, line is ${thresholdNum}`);
  } else if (mockAverage > thresholdNum + 5) {
    analysis.score = 75;
    analysis.strength = 'STRONG';
    analysis.strengths.push(`Good spot: Player averages ${mockAverage}, line is ${thresholdNum}`);
  } else if (mockAverage > thresholdNum) {
    analysis.score = 55;
    analysis.strength = 'MEDIUM';
    analysis.issues.push(`Tight: Player averages only ${mockAverage}, need ${thresholdNum}`);
  } else {
    analysis.score = 25;
    analysis.strength = 'WEAK';
    analysis.recommendation = 'INVESTIGATE';
    analysis.issues.push(`Below average: Player averages ${mockAverage}, threshold is ${thresholdNum}`);
  }

  // Confidence scoring
  const userConfidence = leg.confidence || 'Medium';
  if (analysis.score < 40 && userConfidence === 'High') {
    analysis.issues.push('⚠️ Your confidence is high but data suggests weak leg');
  }

  return analysis;
}

function calculateParlayStics(analysis, pickData) {
  // Calculate hit rate based on individual leg scores
  const legScores = analysis.legAnalysis.map(l => l.score / 100);
  analysis.expectedHitRate = legScores.reduce((a, b) => a * b, 1);

  // Calculate expected payout
  const odds = parseFloat(pickData.originalOdds) || 900;
  const oddsDecimal = (odds + 100) / 100;
  analysis.estimatedEV = (analysis.expectedHitRate * oddsDecimal) - 1;
  analysis.estimatedROI = (analysis.estimatedEV * 100).toFixed(2);

  // Average score across legs
  const avgScore = analysis.legAnalysis.reduce((a, b) => a + b.score, 0) / analysis.legAnalysis.length;
  analysis.overallConfidence = Math.round(avgScore);

  // Check for correlations (same game, same team)
  checkParleyCorrelation(analysis, pickData);

  // Count strong/weak legs
  const strongLegs = analysis.legAnalysis.filter(l => l.score > 70).length;
  const weakLegs = analysis.legAnalysis.filter(l => l.score < 50).length;

  analysis.strongLegCount = strongLegs;
  analysis.weakLegCount = weakLegs;
}

function checkParleyCorrelation(analysis, pickData) {
  // Check if all legs are from same game
  const teams = pickData.originalLegs.map(leg => extractTeamFromLeg(leg));
  const uniqueTeams = new Set(teams);

  if (uniqueTeams.size <= 2) {
    analysis.strengths.push('✅ Single-game parlay (positive correlation allowed)');
    analysis.correlationStatus = 'POSITIVE';
  } else if (uniqueTeams.size > 5) {
    analysis.issues.push('⚠️ Mixed-game parlay with many teams (negative correlation)');
    analysis.correlationStatus = 'NEGATIVE';
  }
}

function applyStrategyRules(analysis, pickData) {
  // Rule 1: Leg count
  if (analysis.legAnalysis.length > 8) {
    analysis.warnings.push(`⚠️ Parlay has ${analysis.legAnalysis.length} legs - hit rate drops to ${(analysis.expectedHitRate * 100).toFixed(1)}%`);
    analysis.warnings.push(`Recommended: Reduce to 5-6 legs for better ROI`);
  }

  // Rule 2: Weak legs
  if (analysis.weakLegCount > 0) {
    analysis.issues.push(`${analysis.weakLegCount} weak leg(s) detected - consider removal`);
    
    // Mark weak legs for removal
    analysis.legAnalysis.forEach((leg, index) => {
      if (leg.score < 50) {
        analysis.removedLegs.push({
          legNumber: index + 1,
          player: leg.player,
          reason: `Weak leg (${leg.score}/100): ${leg.issues[0]}`,
          strength: leg.score
        });
      }
    });
  }

  // Rule 3: Wager sizing (Kelly Criterion)
  const kellySuggestion = calculateKellySize(analysis.expectedHitRate, pickData.wager);
  if (kellySuggestion.recommendation) {
    analysis.warnings.push(kellySuggestion.recommendation);
  }

  // Rule 4: Expected Value
  if (analysis.estimatedROI < -10) {
    analysis.issues.push(`Negative EV: Expected ROI is ${analysis.estimatedROI}%`);
  } else if (analysis.estimatedROI > 5) {
    analysis.strengths.push(`Positive EV: Expected ROI is ${analysis.estimatedROI}%`);
  }
}

function makeRecommendation(analysis) {
  if (analysis.issues.length > 0 && analysis.weakLegCount > 2) {
    analysis.recommendation = 'SKIP';
  } else if (analysis.issues.length > 0 || analysis.removedLegs.length > 0) {
    analysis.recommendation = 'REFINE';
  } else if (analysis.overallConfidence > 70 && analysis.estimatedROI > 0) {
    analysis.recommendation = 'BET';
  } else if (analysis.overallConfidence > 60) {
    analysis.recommendation = 'BET';
  } else {
    analysis.recommendation = 'REFINE';
  }
}

function calculateKellySize(hitRate, currentWager) {
  // Kelly formula: f = (bp - q) / b
  // Simplified for parlays
  const b = 9; // ~+900 odds
  const p = hitRate;
  const q = 1 - p;
  
  const kellyFraction = (b * p - q) / b;
  const optimalWager = 1000 * kellyFraction; // Assume $1000 bankroll

  if (optimalWager < currentWager) {
    return {
      recommendation: `⚠️ Wager too high: Consider reducing from $${currentWager} to $${optimalWager.toFixed(2)}`
    };
  } else if (optimalWager > currentWager * 1.5) {
    return {
      recommendation: `💰 Can increase wager: Kelly suggests $${optimalWager.toFixed(2)}`
    };
  }

  return { recommendation: null };
}

function getMockPlayerAverage(player, stat) {
  // Return mock averages for testing
  const mockData = {
    'Patrick Mahomes': { 'Passing Yards': 265 },
    'Travis Kelce': { 'Receiving Yards': 75 },
    'Rashee Rice': { 'Receiving Yards': 55 },
    'Isiah Pacheco': { 'Rushing Yards': 65 },
    'James Robinson': { 'Rushing Yards': 72 },
    'Franz Wagner': { 'Points': 18 }, // Below 20+ line consistently
    'Brandon Ingram': { 'Points': 22 }, // Below 25+ line
    'LeBron James': { 'Points': 24 },
    'Nikola Jokic': { 'Points': 26 }
  };

  return mockData[player]?.[stat] || 50; // Default fallback
}

function extractTeamFromLeg(leg) {
  // Extract team from player data
  // This would be enhanced with real team data
  return leg.player?.split(' ')[0] || 'Unknown';
}

export default analyzeSubmittedPick;
