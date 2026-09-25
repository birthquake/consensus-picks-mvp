// FILE LOCATION: api/moneyline.js
// Game-outcome (moneyline) picks — no player props, since props aren't legal
// betting products in every state. NFL only for now; the response shape is
// league-agnostic so other sports can be added the same way later.
//
// Usage: GET /api/moneyline?sport=nfl
//
// Methodology: unlike every other analyzer in this app, this doesn't build a
// projection from scratch — ESPN's own game summary endpoint already carries
// two things that make this tractable:
//   - `predictor`: ESPN's own FPI-based win probability for each team
//     (pregame only; null once a game finishes)
//   - `pickcenter`: real DraftKings moneyline odds, free, no API key
// The "pick" is a straight comparison: does ESPN's model win probability
// diverge meaningfully from what the real market is pricing in (the
// moneyline, converted to implied probability and de-vigged)? Same
// "quantitative edge vs. a real number" pattern the rest of the app already
// uses (e.g. MLB's real-odds overlay), just at the game level instead of the
// player level. No per-player fetching needed, so this is one lightweight
// endpoint rather than the two-step scan/analyze flow the prop analyzers use.

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MIN_EDGE_PP = 6; // minimum edge (percentage points) to surface a pick at all

async function fetchWithTimeout(url, ms = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ─── Odds math ────────────────────────────────────────────────────────────────

function americanToImplied(odds) {
  if (odds == null || isNaN(odds)) return null;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

// Normalizes home+away implied probabilities to sum to 100%, removing the
// sportsbook's built-in margin (the "vig") so they're comparable to a model's
// win probability, which sums to ~100% by construction.
function devig(homeImplied, awayImplied) {
  if (homeImplied == null || awayImplied == null) return { home: null, away: null };
  const sum = homeImplied + awayImplied;
  if (!sum) return { home: null, away: null };
  return { home: homeImplied / sum, away: awayImplied / sum };
}

function computeRating(edgePP) {
  if (edgePP >= 12) return 5;
  if (edgePP >= 9)  return 4;
  return 3; // MIN_EDGE_PP (6) is the floor for being included at all
}

// ─── NFL weekly scoreboard (mirrors api/scan.js's NFL branch) ────────────────

async function getThisWeeksGames() {
  const thisWeekData = await fetchWithTimeout(
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
  );
  const weekNumber = thisWeekData?.week?.number ?? null;
  let events = thisWeekData?.events ?? [];
  let pre = events.filter(e => e.competitions?.[0]?.status?.type?.state === 'pre');

  if (pre.length === 0 && weekNumber != null) {
    const nextWeekData = await fetchWithTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${weekNumber + 1}&seasontype=2`
    );
    events = nextWeekData?.events ?? [];
    pre = events.filter(e => e.competitions?.[0]?.status?.type?.state === 'pre');
  }

  return pre;
}

// ─── Per-game pick ────────────────────────────────────────────────────────────

async function buildGamePick(event) {
  const comp = event.competitions?.[0];
  const home = comp?.competitors?.find(c => c.homeAway === 'home');
  const away = comp?.competitors?.find(c => c.homeAway === 'away');

  const summary = await fetchWithTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${event.id}`
  );
  if (!summary) return null;

  const predictor = summary.predictor;
  const pickcenterEntry = (summary.pickcenter ?? []).find(p => p.provider?.priority === 1) ?? summary.pickcenter?.[0];
  if (!predictor || !pickcenterEntry) return null; // lines/FPI not posted yet

  const fpiHome = parseFloat(predictor.homeTeam?.gameProjection);
  const fpiAway = parseFloat(predictor.awayTeam?.gameProjection);
  const mlHome  = pickcenterEntry.homeTeamOdds?.moneyLine;
  const mlAway  = pickcenterEntry.awayTeamOdds?.moneyLine;
  if (isNaN(fpiHome) || isNaN(fpiAway) || mlHome == null || mlAway == null) return null;

  const { home: marketHome, away: marketAway } = devig(americanToImplied(mlHome), americanToImplied(mlAway));
  if (marketHome == null) return null;

  const edgeHomePP = fpiHome - marketHome * 100;
  const edgeAwayPP = fpiAway - marketAway * 100;

  const pickHome = edgeHomePP >= edgeAwayPP;
  const edgePP   = pickHome ? edgeHomePP : edgeAwayPP;
  if (edgePP < MIN_EDGE_PP) return null;

  const pickTeam = pickHome ? home : away;
  const oppTeam  = pickHome ? away : home;

  return {
    gameId: event.id,
    team: pickTeam?.team?.displayName,
    teamAbbrev: pickTeam?.team?.abbreviation,
    opponent: oppTeam?.team?.displayName,
    opponentAbbrev: oppTeam?.team?.abbreviation,
    isHome: pickHome,
    moneyLine: pickHome ? mlHome : mlAway,
    fpiProb: Math.round((pickHome ? fpiHome : fpiAway) * 10) / 10,
    marketProb: Math.round((pickHome ? marketHome : marketAway) * 1000) / 10,
    edge: Math.round(edgePP * 10) / 10,
    rating: computeRating(edgePP),
    gameDate: comp?.date,
    shortName: event.shortName,
  };
}

// ─── Claude rationale (one batched call for the whole week) ──────────────────

async function attachRationales(picks) {
  if (picks.length === 0) return picks;

  const prompt = `You are an expert sports bettor. For each NFL moneyline pick below, the team, edge, and star rating are already finally determined — do not change them. Write a 1-2 sentence rationale for each pick, citing the specific numbers (ESPN's FPI win probability vs. the market-implied probability from the actual moneyline).

PICKS:
${picks.map((p, i) => `${i + 1}. ${p.team} (${p.isHome ? 'home' : 'away'}) ML ${p.moneyLine > 0 ? '+' : ''}${p.moneyLine} vs ${p.opponent} — FPI: ${p.fpiProb}% | Market (de-vigged): ${p.marketProb}% | Edge: +${p.edge}pp | Rating: ${p.rating}★`).join('\n')}

Return ONLY a JSON array of rationale strings, in the same order, no markdown:
["rationale for pick 1", "rationale for pick 2", ...]`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content[0].text.trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    const rationales = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    return picks.map((p, i) => ({ ...p, rationale: rationales[i] ?? null }));
  } catch (err) {
    console.error('[moneyline] Rationale generation failed:', err.message);
    return picks.map(p => ({ ...p, rationale: null }));
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sport = (req.query.sport || 'nfl').toLowerCase();
  if (sport !== 'nfl') {
    return res.status(400).json({ error: `Unsupported sport: ${sport}` });
  }

  try {
    const games = await getThisWeeksGames();
    console.log(`[moneyline] Checking ${games.length} games this week`);

    const results = await Promise.all(games.map(e => buildGamePick(e).catch(() => null)));
    const picks = results.filter(Boolean).sort((a, b) => b.edge - a.edge);

    console.log(`[moneyline] ${picks.length}/${games.length} games cleared the ${MIN_EDGE_PP}pp edge threshold`);

    const picksWithRationale = await attachRationales(picks);

    return res.status(200).json({
      success: true,
      sport: 'nfl',
      games_checked: games.length,
      picks: picksWithRationale,
      scanned_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[moneyline] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
