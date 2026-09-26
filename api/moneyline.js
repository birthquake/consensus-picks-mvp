// FILE LOCATION: api/moneyline.js
// Game-outcome (moneyline) picks — no player props, since props aren't legal
// betting products in every state. NFL + NBA + MLB + NHL.
//
// Usage: GET /api/moneyline?sport=nfl|nba|mlb|nhl
//
// Methodology: unlike every other analyzer in this app, this doesn't build a
// projection from scratch — ESPN's own game summary endpoint already carries
// two things that make this tractable, for every sport it covers:
//   - `predictor`: ESPN's own power-rating win probability for each team
//     (FPI for NFL, BPI for NBA, "Matchup Predictor" for MLB/NHL — pregame
//     only; null once a game finishes)
//   - `pickcenter`: real DraftKings moneyline odds, free, no API key
// The "pick" is a straight comparison: does ESPN's model win probability
// diverge meaningfully from what the real market is pricing in (the
// moneyline, converted to implied probability and de-vigged)? Same
// "quantitative edge vs. a real number" pattern the rest of the app already
// uses (e.g. MLB's real-odds overlay), just at the game level instead of the
// player level. No per-player fetching needed, so this is one lightweight
// endpoint rather than the two-step scan/analyze flow the prop analyzers use.
//
// Outcome tracking: every generated pick is saved server-side (not
// frontend-triggered like player props) to the `moneyline_picks` Firestore
// collection, de-duped by gameId. Graded daily by gradeMoneylinePicks() in
// api/cron/fetch-game-results.js, same cron that already grades
// halftime_picks. `?stats=true` returns aggregate accuracy for a sport.
//
// In-season sample-size confidence: both teams' current-season record is
// already present on the same summary response used for predictor/pickcenter
// (header.competitions[0].competitors[].record) — no extra fetch needed.
// computeRating() docks the rating when either team has fewer games played
// than THIN_DATA_THRESHOLD, since a power rating leaning mostly on
// preseason priors is a weaker signal than one with real current-season data
// behind it — same "small sample" penalty pattern every player-prop
// computeRating already applies.
//
// Remaining known gap: single-book (DraftKings), single-snapshot pricing —
// no line-movement/CLV awareness. Not yet addressed.
//
// NBA/NHL note: added while each was still in preseason (no real BPI/lines
// posted yet). The same graceful "skip if predictor/pickcenter missing"
// handling that covers early-week NFL games before lines post also covers
// this, so picks will just start appearing once each season is underway —
// confirmed structurally (verified live that both `predictor` and
// `pickcenter` are valid fields on their game summaries) but not against
// real numbers the way NFL/MLB were (both in-season when added/verified).

import Anthropic from '@anthropic-ai/sdk';
import { initializeApp, cert, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
let firebaseApp;
try { firebaseApp = getApp(); } catch {
  firebaseApp = initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore(firebaseApp);

const MIN_EDGE_PP = 6; // minimum edge (percentage points) to surface a pick at all

// Games played before a power rating has enough current-season data to
// trust — roughly the first ~10-15% of each sport's season length.
const THIN_DATA_THRESHOLD = { nfl: 3, nba: 8, mlb: 15, nhl: 8 };

const SPORT_CONFIG = {
  nfl: { key: 'nfl', sport: 'football',   league: 'nfl', label: 'NFL', cadence: 'weekly' },
  nba: { key: 'nba', sport: 'basketball', league: 'nba', label: 'NBA', cadence: 'daily' },
  mlb: { key: 'mlb', sport: 'baseball',   league: 'mlb', label: 'MLB', cadence: 'daily' },
  nhl: { key: 'nhl', sport: 'hockey',     league: 'nhl', label: 'NHL', cadence: 'daily' },
};

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

function computeRating(edgePP, gamesPlayed, threshold) {
  let score = edgePP >= 12 ? 5 : edgePP >= 9 ? 4 : 3; // MIN_EDGE_PP (6) is the floor for being included at all
  if (gamesPlayed != null && threshold != null && gamesPlayed < threshold) score -= 1;
  return Math.max(1, Math.min(5, score));
}

// Parses the "total" record (e.g. "2-0") off a competitor into games played.
// Field name differs by endpoint — scoreboard events use `records`, summary
// competitors use `record` — so check both.
function getGamesPlayed(competitor) {
  const records = competitor?.records ?? competitor?.record ?? [];
  const total = records.find(r => r.type === 'total');
  if (!total?.summary) return null;
  const parts = total.summary.split('-').map(n => parseInt(n, 10));
  if (parts.some(isNaN)) return null;
  return parts.reduce((a, b) => a + b, 0);
}

// ─── Games to check ───────────────────────────────────────────────────────────

// Weekly-cadence sports (NFL): mirrors api/scan.js's NFL branch — current
// week's scoreboard, falling forward to next week if this week is done.
async function getWeeksGames(cfg) {
  const thisWeekData = await fetchWithTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard`
  );
  const weekNumber = thisWeekData?.week?.number ?? null;
  let events = thisWeekData?.events ?? [];
  let pre = events.filter(e => e.competitions?.[0]?.status?.type?.state === 'pre');

  if (pre.length === 0 && weekNumber != null) {
    const nextWeekData = await fetchWithTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard?week=${weekNumber + 1}&seasontype=2`
    );
    events = nextWeekData?.events ?? [];
    pre = events.filter(e => e.competitions?.[0]?.status?.type?.state === 'pre');
  }

  return pre;
}

// Daily-cadence sports (NBA, and MLB/NHL later): today's games, falling
// forward to tomorrow's if today's slate is done — same ET-date handling
// api/scan.js uses for its non-NFL branch.
async function getDaysGames(cfg) {
  const nowET    = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const fmt = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const today    = fmt(nowET);
  const tomorrow = fmt(new Date(nowET.getTime() + 86400000));

  const [todayData, tomorrowData] = await Promise.all([
    fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard?dates=${today}`),
    fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard?dates=${tomorrow}`),
  ]);

  const preToday    = (todayData?.events ?? []).filter(e => e.competitions?.[0]?.status?.type?.state === 'pre');
  const preTomorrow = (tomorrowData?.events ?? []).filter(e => e.competitions?.[0]?.status?.type?.state === 'pre');

  return preToday.length > 0 ? preToday : preTomorrow;
}

async function getGamesToCheck(cfg) {
  return cfg.cadence === 'weekly' ? getWeeksGames(cfg) : getDaysGames(cfg);
}

// ─── Per-game pick ────────────────────────────────────────────────────────────

async function buildGamePick(event, cfg) {
  const comp = event.competitions?.[0];
  const home = comp?.competitors?.find(c => c.homeAway === 'home');
  const away = comp?.competitors?.find(c => c.homeAway === 'away');

  const summary = await fetchWithTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/summary?event=${event.id}`
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

  // Reliability of the divergence is capped by whichever team's rating has
  // less current-season data behind it.
  const gamesPlayed = Math.min(
    getGamesPlayed(home) ?? 0,
    getGamesPlayed(away) ?? 0,
  );
  const threshold = THIN_DATA_THRESHOLD[cfg.key];

  return {
    gameId: event.id,
    sport: cfg.sport,
    league: cfg.league,
    team: pickTeam?.team?.displayName,
    teamAbbrev: pickTeam?.team?.abbreviation,
    opponent: oppTeam?.team?.displayName,
    opponentAbbrev: oppTeam?.team?.abbreviation,
    isHome: pickHome,
    moneyLine: pickHome ? mlHome : mlAway,
    fpiProb: Math.round((pickHome ? fpiHome : fpiAway) * 10) / 10,
    marketProb: Math.round((pickHome ? marketHome : marketAway) * 1000) / 10,
    edge: Math.round(edgePP * 10) / 10,
    rating: computeRating(edgePP, gamesPlayed, threshold),
    gamesPlayed,
    gameDate: comp?.date,
    shortName: event.shortName,
  };
}

// ─── Claude rationale (one batched call for the whole week) ──────────────────

async function attachRationales(picks, label) {
  if (picks.length === 0) return picks;

  const prompt = `You are an expert sports bettor. For each ${label} moneyline pick below, the team, edge, and star rating are already finally determined — do not change them. Write a 1-2 sentence rationale for each pick, citing the specific numbers (ESPN's power-rating win probability vs. the market-implied probability from the actual moneyline).

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

// ─── Outcome tracking ─────────────────────────────────────────────────────────

// Saves generated picks server-side (not frontend-triggered like player
// props) so every pick gets tracked regardless of whether anyone views the
// page. De-duped by gameId — one pick per game, so no composite key needed.
async function saveMoneylinePicks(picks, sportKey) {
  if (picks.length === 0) return;

  try {
    const existingSnap = await db
      .collection('moneyline_picks')
      .where('sportKey', '==', sportKey)
      .where('status', '==', 'pending')
      .get();
    const existingGameIds = new Set(existingSnap.docs.map(d => d.data().gameId));

    const batch = db.batch();
    let saved = 0;
    for (const p of picks) {
      if (existingGameIds.has(p.gameId)) continue;
      const docRef = db.collection('moneyline_picks').doc();
      batch.set(docRef, {
        gameId: p.gameId,
        sportKey,
        sport: p.sport,
        league: p.league,
        team: p.team,
        teamAbbrev: p.teamAbbrev,
        opponent: p.opponent,
        opponentAbbrev: p.opponentAbbrev,
        isHome: p.isHome,
        moneyLine: p.moneyLine,
        fpiProb: p.fpiProb,
        marketProb: p.marketProb,
        edge: p.edge,
        rating: p.rating,
        rationale: p.rationale ?? null,
        gamesPlayed: p.gamesPlayed,
        gameDate: p.gameDate,
        shortName: p.shortName,
        status: 'pending',
        actual_winner: null,
        hit: null,
        created_at: new Date(),
        graded_at: null,
      });
      saved++;
    }
    if (saved > 0) await batch.commit();
    console.log(`[moneyline] Saved ${saved}/${picks.length} new picks for ${sportKey} (${picks.length - saved} already tracked)`);
  } catch (err) {
    // Tracking is best-effort — never let a save failure break the picks response
    console.error('[moneyline] saveMoneylinePicks failed:', err.message);
  }
}

async function getMoneylineStats(sportKey) {
  const snap = await db.collection('moneyline_picks').where('sportKey', '==', sportKey).get();
  const all = snap.docs.map(d => d.data());
  const graded = all.filter(p => p.status === 'hit' || p.status === 'miss');
  const hits = graded.filter(p => p.hit === true);

  const byRating = {};
  for (let r = 1; r <= 5; r++) {
    const rGraded = graded.filter(p => p.rating === r);
    const rHits = rGraded.filter(p => p.hit);
    byRating[r] = {
      total: rGraded.length,
      hits: rHits.length,
      hitRate: rGraded.length > 0 ? Math.round((rHits.length / rGraded.length) * 100) : null,
    };
  }

  return {
    total: all.length,
    graded: graded.length,
    pending: all.filter(p => p.status === 'pending').length,
    hits: hits.length,
    misses: graded.filter(p => p.hit === false).length,
    hit_rate: graded.length > 0 ? Math.round((hits.length / graded.length) * 100) : null,
    by_rating: byRating,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sportKey = (req.query.sport || 'nfl').toLowerCase();
  const cfg = SPORT_CONFIG[sportKey];
  if (!cfg) {
    return res.status(400).json({ error: `Unsupported sport: ${sportKey}` });
  }

  if (req.query.stats === 'true') {
    try {
      const summary = await getMoneylineStats(sportKey);
      return res.status(200).json({ success: true, sport: sportKey, summary });
    } catch (err) {
      console.error('[moneyline] Stats error:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  try {
    const games = await getGamesToCheck(cfg);
    console.log(`[moneyline] ${cfg.label}: checking ${games.length} games`);

    const results = await Promise.all(games.map(e => buildGamePick(e, cfg).catch(() => null)));
    const picks = results.filter(Boolean).sort((a, b) => b.edge - a.edge);

    console.log(`[moneyline] ${cfg.label}: ${picks.length}/${games.length} games cleared the ${MIN_EDGE_PP}pp edge threshold`);

    const picksWithRationale = await attachRationales(picks, cfg.label);

    await saveMoneylinePicks(picksWithRationale, sportKey);

    return res.status(200).json({
      success: true,
      sport: sportKey,
      games_checked: games.length,
      picks: picksWithRationale,
      scanned_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[moneyline] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
