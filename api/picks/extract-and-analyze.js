// FILE LOCATION: api/picks/extract-and-analyze.js
// Takes a base64 bet slip image, extracts picks, enriches them with real ESPN
// context (recent form, injury status), then runs Claude analysis on real data.

import Anthropic from '@anthropic-ai/sdk';
import { initializeApp, cert, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { enrichPicks, formatEnrichmentForPrompt } from '../../lib/espn-enrichment.js';


// ─── Init ─────────────────────────────────────────────────────────────────────

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');

let app;
try {
  app = getApp();
} catch {
  app = initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore(app);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, imageBase64, imageMediaType, game_date } = req.body;

  try {
    if (!userId || !imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, imageBase64',
      });
    }

    console.log(`🔍 Extracting picks for user ${userId}`);

    // ── Step 1: Extract picks from image ─────────────────────────────────────
    const extractedData = await extractPicksFromImage(imageBase64, imageMediaType);
    if (extractedData.error) {
      return res.status(400).json({ success: false, error: extractedData.error });
    }
    if (!extractedData.picks?.length) {
      return res.status(400).json({ success: false, error: 'No picks found in the image' });
    }

    console.log(`✅ Extracted ${extractedData.picks.length} picks`);

    // Resolve game_date: prefer client-provided date, fall back to today
    const resolvedGameDate = game_date || new Date().toISOString().split('T')[0];
    console.log(`Game date: ${resolvedGameDate} (source: ${game_date ? 'client' : 'fallback'})`);

    // ── Step 2: Fetch ESPN enrichment + user history in parallel ─────────────
    let enrichments = [];
    let analytics;

    // Run enrichment and analytics in parallel, with enrichment fully isolated.
    // An enrichment crash or timeout must never prevent the analysis from running.
    [enrichments, analytics] = await Promise.all([
      enrichPicks(extractedData.picks, resolvedGameDate)
        .catch(err => {
          console.warn('⚠️ ESPN enrichment failed:', err.message);
          return extractedData.picks.map(p => ({ player: p.player, error: err.message }));
        }),
      fetchUserAnalytics(userId),
    ]);

    const espnContext = formatEnrichmentForPrompt(enrichments);
    const userContext = buildUserContext(analytics);

    console.log(`📊 ESPN enrichment: ${enrichments.filter(e => !e.error).length}/${extractedData.picks.length} picks enriched`);
    console.log(`📈 User stats: ${analytics.total_bets} bets, ${analytics.win_rate}% win rate`);

    // ── Step 3: Grade the slip ────────────────────────────────────────────────
    const { grade, confidence, reason } = await gradePicks(
      extractedData.picks,
      userContext,
      espnContext,
    );

    console.log(`⭐ Grade: ${grade} (${confidence})`);

    // ── Step 4: Full analysis with real ESPN data ─────────────────────────────
    const analysisData = await analyzePicks(
      extractedData.picks,
      userContext,
      espnContext,
      grade,
      confidence,
      enrichments,
    );

    console.log(`✅ Analysis complete`);

    // ── Step 5: Store in Firestore ────────────────────────────────────────────
    const betDocRef = await db.collection('users').doc(userId).collection('bets').add({
      picks: extractedData.picks,
      sportsbook: extractedData.sportsbook || 'Unknown',
      parlay_legs: extractedData.parlay_legs || extractedData.picks.length,
      wager_amount: extractedData.wager_amount || null,
      potential_payout: extractedData.potential_payout || null,

      analysis: analysisData,
      grade,
      confidence,
      espn_enrichment: enrichments,
      user_analytics_snapshot: analytics,

      game_date: resolvedGameDate,
      status: 'pending_results',
      created_at: new Date(),
      analyzed_at: new Date(),

      outcomes: null,
      profit_loss: null,
      completed_at: null,
    });

    console.log(`📝 Saved bet: ${betDocRef.id}`);

    return res.status(200).json({
      success: true,
      betId: betDocRef.id,
      sportsbook: extractedData.sportsbook,
      picks: extractedData.picks,
      parlay_legs: extractedData.parlay_legs || extractedData.picks.length,
      wager_amount: extractedData.wager_amount,
      potential_payout: extractedData.potential_payout,
      grade,
      confidence,
      reason,
      analysis: analysisData,
      espn_enrichment: enrichments,
      user_stats: {
        total_bets: analytics.total_bets,
        win_rate: analytics.win_rate,
        roi: analytics.roi,
      },
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process bet slip',
    });
  }
}

// ─── Step implementations ─────────────────────────────────────────────────────

async function extractPicksFromImage(imageBase64, imageMediaType) {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: imageMediaType || 'image/jpeg', data: imageBase64 },
        },
        {
          type: 'text',
          text: `Analyze this sports bet slip screenshot and extract all picks/bets visible.
Return ONLY valid JSON with no markdown, no code fences, no extra text.

For each pick extract:
- player: Player or team name (exact as shown)
- stat: Stat being bet on (e.g. "Passing Yards", "Points", "Rebounds", "Moneyline")
- bet_type: "Over", "Under", "Moneyline", or "Spread"
- line: The numeric line (null if not shown)
- odds: Odds shown (e.g. -110, +150)
- sport: "NFL", "NBA", "NHL", "MLB", "NCAAF", "NCAAB" — infer if not shown

Also extract at the top level:
- sportsbook: Platform name (DraftKings, FanDuel, BetMGM, etc.)
- parlay_legs: Number of legs
- potential_payout: Dollar amount shown as payout/to-win
- wager_amount: Dollar amount wagered

Return format:
{"sportsbook":"DraftKings","parlay_legs":3,"wager_amount":25,"potential_payout":400,"picks":[{"player":"Shai Gilgeous-Alexander","stat":"Points","bet_type":"Over","line":28.5,"odds":-115,"sport":"NBA"}]}

If no valid picks can be extracted return: {"error":"Could not extract picks from this image"}`,
        },
      ],
    }],
  });

  try {
    const raw = msg.content[0].text
      .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return { error: 'Could not parse picks from image. Please use a clear bet slip screenshot.' };
  }
}

async function gradePicks(picks, userContext, espnContext) {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Grade this sports parlay A-F based on pick quality, recent player form, and the user's historical performance.

${userContext}

${espnContext || '(No live ESPN data available)'}

PICKS:
${formatPicksForPrompt(picks)}

Respond with ONLY these three lines:
GRADE: [A/B/C/D/F]
CONFIDENCE: [High/Medium/Low]
REASON: [One sentence]`,
    }],
  });

  const text = msg.content[0].text;
  return {
    grade: text.match(/GRADE:\s*([A-F])/)?.[1] || 'N/A',
    confidence: text.match(/CONFIDENCE:\s*(High|Medium|Low)/)?.[1] || 'N/A',
    reason: text.match(/REASON:\s*(.+?)(?:\n|$)/)?.[1]?.trim() || 'Unable to assess',
  };
}

async function analyzePicks(picks, userContext, espnContext, grade, confidence, enrichments) {
  // Build a per-pick summary of what ESPN told us, for Claude to reference directly
  const enrichedCount = enrichments.filter(e => e && !e.error && e.recentForm?.length > 0).length;
  const pickSummaries = picks.map((pick, i) => {
    const e = enrichments[i];
    if (!e || e.error) return `${i + 1}. ${pick.player} — ${pick.stat} ${pick.bet_type} ${pick.line} (no ESPN data available)`;
    const formStr = e.recentForm?.map(g => g.value ?? 'DNP').join(', ') || 'unavailable';
    const injStr = e.injuryStatus && e.injuryStatus !== 'Active' ? ` ⚠️ ${e.injuryStatus}` : '';
    return `${i + 1}. ${e.playerFullName || pick.player}${injStr} — ${pick.stat} ${pick.bet_type} ${pick.line} | Last 5: ${formStr}`;
  }).join('\n');

  const dataNote = enrichedCount < picks.length
    ? `\nNote: ESPN data available for ${enrichedCount}/${picks.length} players. Analyze available data thoroughly; for players without data, use your general knowledge.`
    : '';

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are an expert sports betting analyst with access to real player data. Analyze this parlay using the actual ESPN stats provided.

${userContext}

${espnContext || '(No live ESPN data available)'}

PICKS WITH RECENT FORM:
${pickSummaries}${dataNote}

GRADE: ${grade} (${confidence})

Return ONLY valid JSON (no markdown, no code fences):
{
  "pickAnalysis": "2-3 sentences grounded in the actual ESPN form data shown above. Call out specific numbers.",
  "strengths": [
    "Strength backed by a specific stat from the ESPN data",
    "Another data-grounded strength",
    "Third strength"
  ],
  "risks": [
    "Risk grounded in actual recent form or injury status",
    "Another data-grounded risk",
    "Third risk"
  ],
  "recommendedAdjustments": "2-3 sentences with specific suggestions. Reference actual averages vs lines. Mention any injury flags."
}

Be precise. If a player is averaging 31 pts and the line is 24.5, say so. If they are trending down, say so with numbers.`,
    }],
  });

  try {
    const raw = msg.content[0].text
      .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return {
      pickAnalysis: msg.content[0].text,
      strengths: [],
      risks: [],
      recommendedAdjustments: 'Unable to parse structured analysis.',
    };
  }
}

// ─── User analytics (unchanged from original) ─────────────────────────────────

async function fetchUserAnalytics(userId) {
  const betsSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('bets')
    .where('status', '==', 'complete')
    .limit(50)
    .get();

  return calculateAnalytics(betsSnapshot.docs);
}

function calculateAnalytics(docs) {
  const bets = docs.map(doc => doc.data());

  if (bets.length === 0) {
    return { total_bets: 0, wins: 0, losses: 0, win_rate: 0,
             total_profit: 0, roi: 0, by_category: {}, by_league: {},
             best_category: 'N/A', worst_category: 'N/A' };
  }

  const wins = bets.filter(b => b.profit_loss > 0).length;
  const losses = bets.filter(b => b.profit_loss <= 0).length;
  const win_rate = Math.round((wins / bets.length) * 100);
  const total_profit = bets.reduce((s, b) => s + (b.profit_loss || 0), 0);
  const total_wagered = bets.reduce((s, b) => s + (b.wager_amount || 0), 0);
  const roi = total_wagered > 0 ? Math.round((total_profit / total_wagered) * 100) : 0;

  const by_category = {};
  const by_league = {};

  bets.forEach(bet => {
    (bet.picks || []).forEach(pick => {
      const cat = `${pick.stat}_${pick.bet_type}`;
      if (!by_category[cat]) by_category[cat] = { wins: 0, total: 0 };
      by_category[cat].total++;
      if (bet.profit_loss > 0) by_category[cat].wins++;

      const league = pick.sport || 'Unknown';
      if (!by_league[league]) by_league[league] = { wins: 0, total: 0 };
      by_league[league].total++;
      if (bet.profit_loss > 0) by_league[league].wins++;
    });
  });

  let best = { category: 'N/A', rate: 0 };
  let worst = { category: 'N/A', rate: 1 };
  Object.entries(by_category).forEach(([cat, d]) => {
    const rate = d.total >= 3 ? d.wins / d.total : 0;
    if (rate > best.rate) best = { category: cat, rate: Math.round(rate * 100) };
    if (d.total >= 3 && rate < worst.rate) worst = { category: cat, rate: Math.round(rate * 100) };
  });

  return { total_bets: bets.length, wins, losses, win_rate, total_profit,
           roi, by_category, by_league,
           best_category: best.category, best_rate: best.rate,
           worst_category: worst.category, worst_rate: worst.rate };
}

function buildUserContext(analytics) {
  if (analytics.total_bets === 0) {
    return 'USER PROFILE: New user — no betting history yet. Provide general advice.';
  }

  let ctx = `USER PROFILE:
- Total Bets: ${analytics.total_bets}
- Win Rate: ${analytics.win_rate}%
- P/L: $${analytics.total_profit >= 0 ? '+' : ''}${analytics.total_profit.toFixed(2)}
- ROI: ${analytics.roi}%`;

  if (analytics.best_category !== 'N/A') {
    ctx += `\n- Best bet type: ${analytics.best_category} (${analytics.best_rate}% hit rate)`;
  }
  if (analytics.worst_category !== 'N/A') {
    ctx += `\n- Worst bet type: ${analytics.worst_category} (${analytics.worst_rate}% hit rate)`;
  }

  const leagues = Object.entries(analytics.by_league)
    .map(([l, d]) => `${l}: ${d.total > 0 ? Math.round((d.wins/d.total)*100) : 0}%`)
    .join(', ');
  if (leagues) ctx += `\n- By league: ${leagues}`;

  ctx += '\n\nReference these numbers directly in your analysis.';
  return ctx;
}

function formatPicksForPrompt(picks) {
  return picks.map((p, i) =>
    `${i + 1}. ${p.player} — ${p.stat} ${p.bet_type} ${p.line ?? '?'} (${p.odds ?? '?'}) [${p.sport}]`
  ).join('\n');
}
