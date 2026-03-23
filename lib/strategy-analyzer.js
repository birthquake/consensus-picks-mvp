// FILE LOCATION: api/utils/strategy-analyzer.js

const BLACKLIST = {
  'Franz Wagner': { reason: '0-4 record on 20+/18+', confidence: 0 },
  'Brandon Ingram': { reason: '0-3 record on 15+/18+', confidence: 0 },
  'RJ Barrett': { reason: '0-2 record', confidence: 0.2 },
};

export function getQuickAnalysis(pickData) {
  const analysis = {
    legIssues: [],
    redFlags: [],
    greenFlags: [],
    legCount: pickData.originalLegs.length,
    hasBlacklisted: false
  };

  // Quick checks on each leg
  pickData.originalLegs.forEach((leg, index) => {
    if (BLACKLIST[leg.player]) {
      analysis.hasBlacklisted = true;
      analysis.redFlags.push(`Leg ${index + 1}: ${leg.player} is blacklisted - ${BLACKLIST[leg.player].reason}`);
    }

    // Check if threshold seems crazy
    const mockAvg = getMockPlayerAverage(leg.player, leg.stat);
    const thresholdNum = parseInt(leg.threshold);
    
    if (mockAvg && thresholdNum < mockAvg - 20) {
      analysis.redFlags.push(`Leg ${index + 1}: Threshold seems low (${thresholdNum} vs avg ${mockAvg})`);
    }
    
    if (mockAvg && thresholdNum > mockAvg + 30) {
      analysis.redFlags.push(`Leg ${index + 1}: Threshold seems high (${thresholdNum} vs avg ${mockAvg})`);
    }
  });

  // Check leg count
  if (pickData.originalLegs.length > 10) {
    analysis.redFlags.push(`High leg count (${pickData.originalLegs.length}): Hit rate drops exponentially`);
  }

  if (pickData.originalLegs.length <= 6) {
    analysis.greenFlags.push(`Good leg count (${pickData.originalLegs.length}): Higher hit rate potential`);
  }

  return analysis;
}

function getMockPlayerAverage(player, stat) {
  const mockData = {
    'Patrick Mahomes': { 'Passing Yards': 265 },
    'Travis Kelce': { 'Receiving Yards': 75 },
    'Franz Wagner': { 'Points': 18 },
    'Brandon Ingram': { 'Points': 22 },
    'LeBron James': { 'Points': 24 },
  };
  return mockData[player]?.[stat] || null;
}
