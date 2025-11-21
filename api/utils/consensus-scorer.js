// FILE LOCATION: api/utils/consensus-scorer.js

function parsePick(pickString) {
  const trimmed = pickString.trim();
  
  const match = trimmed.match(/^(.+?)\s+([-+])(\d+(?:\.\d+)?)$/);
  
  if (match) {
    return {
      team: match[1].trim(),
      operator: match[2],
      line: parseFloat(match[3]),
      type: 'spread',
    };
  }

  const ouMatch = trimmed.match(/^(Over|Under)\s+(\d+(?:\.\d+)?)$/i);
  if (ouMatch) {
    return {
      team: ouMatch[1].toLowerCase(),
      operator: null,
      line: parseFloat(ouMatch[2]),
      type: 'total',
    };
  }

  return null;
}

function arePicksSimilar(pick1, pick2, threshold = 0.5) {
  if (pick1.type !== pick2.type) return false;
  if (pick1.team.toLowerCase() !== pick2.team.toLowerCase()) return false;
  if (pick1.operator !== pick2.operator && pick1.operator && pick2.operator) return false;

  const lineDiff = Math.abs(pick1.line - pick2.line);
  return lineDiff <= threshold;
}

export function groupSimilarPicks(allRawPicks) {
  const groups = [];

  for (const rawPick of allRawPicks) {
    const parsed = parsePick(rawPick.pick);
    if (!parsed) continue;

    let group = groups.find(g => arePicksSimilar(parsed, g.parsedPick));

    if (!group) {
      group = {
        parsedPick: parsed,
        sources: [],
        lines: [parsed.line],
      };
      groups.push(group);
    }

    group.sources.push({
      name: rawPick.source,
      confidence: rawPick.confidence,
      originalPick: rawPick.pick,
      subreddit: rawPick.subreddit,
      postUrl: rawPick.postUrl,
    });

    group.lines.push(parsed.line);
  }

  return groups;
}

function applyOptionCAdjustment(parsedPick, groupSources) {
  const lines = groupSources.map(s => parsePick(s.originalPick).line);
  const minLine = Math.min(...lines);
  const maxLine = Math.max(...lines);

  let adjustedLine;
  let adjustmentReason;

  if (parsedPick.type === 'total') {
    adjustedLine = minLine;
    adjustmentReason = `Conservative adjustment: range ${minLine}-${maxLine} → ${adjustedLine}`;
  } else if (parsedPick.operator === '-') {
    adjustedLine = minLine;
    adjustmentReason = `Conservative adjustment: range ${minLine}-${maxLine} → ${adjustedLine}`;
  } else {
    adjustedLine = maxLine;
    adjustmentReason = `Conservative adjustment: range ${minLine}-${maxLine} → ${adjustedLine}`;
  }

  return {
    adjustedLine,
    adjustmentReason,
    lineRange: { min: minLine, max: maxLine },
  };
}

export function scoreConsensusPickss(groupedPicks) {
  const scored = [];

  for (const group of groupedPicks) {
    const consensusStrength = group.sources.length;
    const avgConfidence = group.sources.reduce((sum, s) => sum + s.confidence, 0) / group.sources.length;

    if (consensusStrength < 2) continue;

    const adjustment = applyOptionCAdjustment(group.parsedPick, group.sources);

    const pick = {
      id: `${group.parsedPick.team.toLowerCase().replace(/\s+/g, '_')}_${group.parsedPick.line}`,
      sport: inferSport(group.sources),
      
      pick: `${group.parsedPick.team} ${group.parsedPick.operator || ''}${group.parsedPick.line}`,
      adjustedPick: `${group.parsedPick.team} ${group.parsedPick.operator || ''}${adjustment.adjustedLine}`,
      pickType: 'game_prop',
      
      consensusStrength,
      confidenceScore: Math.min(avgConfidence, 1.0),
      adjustmentReason: adjustment.adjustmentReason,
      lineRange: adjustment.lineRange,
      
      sources: group.sources,
      
      firstSeen: Math.floor(Date.now() / 1000),
      lastUpdated: Math.floor(Date.now() / 1000),
      pickStatus: 'pending',
    };

    scored.push(pick);
  }

  scored.sort((a, b) => {
    if (b.consensusStrength !== a.consensusStrength) {
      return b.consensusStrength - a.consensusStrength;
    }
    return b.confidenceScore - a.confidenceScore;
  });

  return scored;
}

function inferSport(sources) {
  const subreddits = sources.map(s => s.subreddit || '').join(' ').toLowerCase();
  
  if (subreddits.includes('nfl')) return 'nfl';
  if (subreddits.includes('nba')) return 'nba';
  if (subreddits.includes('hockey')) return 'nhl';
  
  return 'nba';
}

export function scoreAllPicks(allRawPicks) {
  const grouped = groupSimilarPicks(allRawPicks);
  const scored = scoreConsensusPickss(grouped);
  return scored;
}
