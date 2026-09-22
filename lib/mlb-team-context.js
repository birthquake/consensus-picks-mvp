// FILE LOCATION: lib/mlb-team-context.js
// Team-level MLB context shared between pregame and live analyzers: league
// averages, ballpark factors, lineup-slot weighting, and opponent team ERA.
// Mirrors lib/nfl-team-defense.js's role for NFL.

async function fetchWithTimeout(url, ms = 5000) {
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

// ─── MLB league averages (2024-25 season approximations) ─────────────────────
export const MLB_AVG = {
  teamERA:    4.30,
  starterERA: 4.50,
};

// ─── Ballpark factors ─────────────────────────────────────────────────────────
const PARK_FACTORS = {
  COL: 1.12, CIN: 1.07, PHI: 1.06, TEX: 1.05, BAL: 1.05,
  BOS: 1.04, MIL: 1.03, NYY: 1.03, TOR: 1.02, HOU: 1.02,
  ATL: 1.02, ARI: 1.01, MIN: 1.01, STL: 1.00, LAA: 1.00,
  DET: 1.00, KC:  1.00, CLE: 0.99, WSH: 0.99, CHC: 0.99,
  NYM: 0.99, PIT: 0.99, TB:  0.98, MIA: 0.98, LAD: 0.98,
  SEA: 0.97, CWS: 0.97, CHW: 0.97, OAK: 0.97, ATH: 0.97,
  SF:  0.96, SD:  0.96,
};

export function getParkFactor(teamAbbrev) {
  if (!teamAbbrev) return 1.0;
  return PARK_FACTORS[teamAbbrev.toUpperCase()] ?? 1.0;
}

// ─── Lineup position weighting ────────────────────────────────────────────────
const LINEUP_SLOT_MULTIPLIERS = {
  1: { runs: 1.10, rbi: 0.90 },
  2: { runs: 1.08, rbi: 0.92 },
  3: { runs: 1.02, rbi: 1.08 },
  4: { runs: 0.95, rbi: 1.15 },
  5: { runs: 0.93, rbi: 1.10 },
  6: { runs: 0.90, rbi: 0.90 },
  7: { runs: 0.90, rbi: 0.90 },
  8: { runs: 0.90, rbi: 0.90 },
  9: { runs: 0.90, rbi: 0.90 },
};

export function getLineupMultiplier(slot) {
  if (!slot || slot < 1 || slot > 9) return { runs: 1.0, rbi: 1.0 };
  return LINEUP_SLOT_MULTIPLIERS[slot] || { runs: 1.0, rbi: 1.0 };
}

// ─── Opponent ERA / team pitching stats ───────────────────────────────────────
export async function getTeamPitchingStats(league, teamId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/${league}/teams/${teamId}/statistics`;
  const data = await fetchWithTimeout(url, 3000);
  if (!data) return null;

  const categories = data?.results?.stats?.categories ?? data?.stats?.categories ?? [];

  let teamERA = null, starterERA = null, gamesPlayed = null, whip = null;

  for (const cat of categories) {
    for (const stat of cat?.stats ?? []) {
      const name = stat.name?.toLowerCase();
      const val  = parseFloat(stat.value);
      if (isNaN(val)) continue;
      if (name === 'era' || name === 'earnedrunavg')   teamERA     = val;
      if (name === 'spera' || name === 'startingera')  starterERA  = val;
      if (name === 'gamesplayed' || name === 'games')  gamesPlayed = val;
      if (name === 'whip')                             whip        = val;
    }
  }

  const era = starterERA ?? teamERA;
  if (era == null) return null;

  const batterMultiplier = Math.max(0.80, Math.min(1.20, era / MLB_AVG.starterERA));
  return {
    era: Math.round(era * 100) / 100,
    whip, gamesPlayed,
    batterMultiplier: Math.round(batterMultiplier * 100) / 100,
  };
}
