// FILE LOCATION: api/utils/claude-analyzer.js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function analyzeWithClaude(pickData, userHistory, quickAnalysis) {
  try {
    const prompt = buildAnalysisPrompt(pickData, userHistory, quickAnalysis);

    const message = await client.messages.create({
      model: 'claude-opus-4-1-20250805',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    const analysis = parseClaudeResponse(responseText, pickData, quickAnalysis);

    return analysis;
  } catch (error) {
    console.error('Claude API error:', error);
    // Fallback to quick analysis if Claude fails
    return fallbackAnalysis(pickData, quickAnalysis);
  }
}

function buildAnalysisPrompt(pickData, userHistory, quickAnalysis) {
  return `You are a sports betting expert analyzing a parlay pick submission.

USER'S BETTING HISTORY:
${userHistory ? JSON.stringify(userHistory, null, 2) : 'No history available yet'}

QUICK FLAGS:
Red Flags: ${quickAnalysis.redFlags.join(', ') || 'None detected'}
Green Flags: ${quickAnalysis.greenFlags.join(', ') || 'None detected'}

SUBMITTED PICK:
Sport: ${pickData.sport}
Game: ${pickData.game}
Wager: $${pickData.wager}
Legs: ${pickData.originalLegs.length}
${pickData.originalLegs.map((leg, i) => `  Leg ${i + 1}: ${leg.player} - ${leg.stat} ${leg.threshold} (Confidence: ${leg.confidence})`).join('\n')}
Reasoning: ${pickData.reasoning || 'None provided'}

Your job:
1. Analyze this parlay for edge
2. Check for correlation issues
3. Reference the user's historical performance patterns
4. Make a recommendation: BET, REFINE, or SKIP
5. Suggest specific leg improvements if needed

Be conversational but direct. Focus on actionable insights.`;
}

function parseClaudeResponse(response, pickData, quickAnalysis) {
  const recommendation = extractRecommendation(response);
  
  return {
    recommendation,
    reasoning: response,
    legCount: pickData.originalLegs.length,
    redFlags: quickAnalysis.redFlags,
    greenFlags: quickAnalysis.greenFlags,
    claudeAnalysis: response
  };
}

function extractRecommendation(response) {
  const upperResponse = response.toUpperCase();
  
  if (upperResponse.includes('BET') && !upperResponse.includes('DO NOT BET')) {
    return 'BET';
  }
  if (upperResponse.includes('REFINE') || upperResponse.includes('IMPROVE')) {
    return 'REFINE';
  }
  if (upperResponse.includes('SKIP') || upperResponse.includes('AVOID')) {
    return 'SKIP';
  }
  
  // Default based on red flags
  if (response.includes('strong')) return 'BET';
  if (response.includes('concern') || response.includes('issue')) return 'REFINE';
  return 'REFINE';
}

function fallbackAnalysis(pickData, quickAnalysis) {
  return {
    recommendation: quickAnalysis.redFlags.length > 0 ? 'REFINE' : 'BET',
    reasoning: 'Claude API unavailable, using quick analysis',
    legCount: pickData.originalLegs.length,
    redFlags: quickAnalysis.redFlags,
    greenFlags: quickAnalysis.greenFlags,
    claudeAnalysis: null
  };
}
