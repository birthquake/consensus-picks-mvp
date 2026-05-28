// FILE LOCATION: api/pregame/sabermetrics.js
// Fetches sabermetric data from Baseball Savant (Statcast) for MLB batters.
//
// Stats fetched per batter:
//   - xBA vs BA      : Expected vs Actual Batting Average — regression signal
//   - xwOBA          : Expected Weighted On-Base Average
//   - Platoon splits : AVG vs LHP and vs RHP — used to adjust projection vs today's starter
//
// All data is season-level from the current year.
// Failures are handled gracefully — returns null per player on any error.

const CURRENT_YEAR = new Date().getFullYear();

const MLB_LEAGUE_AVG = {
  babip:      0.298,
  wrcPlus:    100,
  hardHitPct: 38.5,
  xba:        0.248,
};

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, ms = 6000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PaiGrade/1.0)',
        'Accept': 'application/json, text/csv, */*',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.log(`[sabermetrics] HTTP ${res.status} for ${url.substring(0, 80)}`);
      return null;
    }
    return res;
  } catch (err) {
    clearTimeout(timer);
    console.log(`[sabermetrics] Fetch failed for ${url.substring(0, 80)}: ${err.message}`);
    return null;
  }
}

function parseCSV(text) {
  if (!text || !text.trim()) return [];
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/"/g, ''));
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? null; });
    return obj;
  });
}

function safeFloat(val) {
  if (val == null || val === '' || val === 'null') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// ─── Player ID lookup via MLB Stats API ───────────────────────────────────────

async function getMlbamId(playerName) {
  try {
    const encoded = encodeURIComponent(playerName);
    const url     = `https://statsapi.mlb.com/api/v1/people/search?names=${encoded}&sportId=1`;
    const res     = await fetchWithTimeout(url, 5000);
    if (res) {
      const data   = await res.json();
      const people = data?.people || [];
      if (people.length > 0) {
        const match = people.find(p =>
          p.fullName?.toLowerCase() === playerName.toLowerCase()
        ) || people[0];
        if (match?.id) {
          console.log(`[sabermetrics] Found MLBAM ID ${match.id} for ${playerName}`);
          return match.id;
        }
      }
    }

    // Fallback: Baseball Savant search
    const savantUrl = `https://baseballsavant.mlb.com/player/search-all?q=${encoded}&type=batter`;
    const savantRes = await fetchWithTimeout(savantUrl, 5000);
    if (savantRes) {
      const savantData = await savantRes.json();
      if (Array.isArray(savantData) && savantData.length > 0) {
        const match = savantData.find(p =>
          `${p.first_name} ${p.last_name}`.toLowerCase() === playerName.toLowerCase()
        ) || savantData[0];
        const id = match?.id || match?.player_id;
        if (id) {
          console.log(`[sabermetrics] Found MLBAM ID ${id} for ${playerName} via Savant`);
          return id;
        }
      }
    }

    console.log(`[sabermetrics] Could not find MLBAM ID for ${playerName}`);
    return null;
  } catch (err) {
    console.log(`[sabermetrics] getMlbamId error for ${playerName}: ${err.message}`);
    return null;
  }
}

// ─── Statcast season-level batting stats ─────────────────────────────────────
// Baseball Savant expected statistics leaderboard.
// Columns available: last_name, first_name, player_id, year, pa, bip,
//   ba, est_ba, est_ba_minus_ba_diff, slg, est_slg, est_slg_minus_slg_diff,
//   woba, est_woba, est_woba_minus_woba_diff

async function fetchStatcastBatter(mlbamId, playerName) {
  try {
    const lbUrl = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${CURRENT_YEAR}&position=&team=&min=25&csv=true`;
    const res   = await fetchWithTimeout(lbUrl, 10000);
    if (!res) {
      console.log(`[sabermetrics] Could not fetch Statcast leaderboard`);
      return null;
    }

    const text = await res.text();
    if (!text || text.length < 100) {
      console.log(`[sabermetrics] Statcast leaderboard returned empty response`);
      return null;
    }

    const rows = parseCSV(text);
    const row  = rows.find(r =>
      String(r.player_id) === String(mlbamId) ||
      String(r.mlbam_id)  === String(mlbamId)
    );

    if (!row) {
      console.log(`[sabermetrics] No Statcast row found for ${playerName} (ID: ${mlbamId})`);
      return null;
    }

    console.log(`[sabermetrics] Got Statcast data for ${playerName}: xba=${row.est_ba} ba=${row.ba}`);
    return {
      xba:   safeFloat(row.est_ba),
      xslg:  safeFloat(row.est_slg),
      xwoba: safeFloat(row.est_woba),
      ba:    safeFloat(row.ba),
      pa:    safeFloat(row.pa),
      bip:   safeFloat(row.bip),
    };
  } catch (err) {
    console.log(`[sabermetrics] fetchStatcastBatter error: ${err.message}`);
    return null;
  }
}

// ─── Platoon splits via MLB Stats API ────────────────────────────────────────

async function fetchPlatoonSplits(mlbamId, playerName) {
  try {
    const url = `https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=statSplits&group=hitting&season=${CURRENT_YEAR}&sitCodes=vr,vl&gameType=R`;
    const res = await fetchWithTimeout(url, 6000);
    if (!res) {
      console.log(`[sabermetrics] Could not fetch platoon splits for ${playerName}`);
      return null;
    }

    const data   = await res.json();
    const splits = data?.stats?.[0]?.splits || [];

    if (!splits.length) {
      console.log(`[sabermetrics] No platoon splits found for ${playerName}`);
      return null;
    }

    const vsRhpSplit = splits.find(s => s.split?.code === 'vr');
    const vsLhpSplit = splits.find(s => s.split?.code === 'vl');

    const extractSplit = (split) => {
      if (!split?.stat) return null;
      return {
        avg:   safeFloat(split.stat.avg),
        obp:   safeFloat(split.stat.obp),
        slg:   safeFloat(split.stat.slg),
        ops:   safeFloat(split.stat.ops),
        babip: safeFloat(split.stat.babip),
        pa:    safeFloat(split.stat.plateAppearances),
        hits:  safeFloat(split.stat.hits),
        ab:    safeFloat(split.stat.atBats),
      };
    };

    const vsRhp = extractSplit(vsRhpSplit);
    const vsLhp = extractSplit(vsLhpSplit);

    if (!vsRhp && !vsLhp) return null;

    console.log(`[sabermetrics] Got platoon splits for ${playerName}: vsRHP avg=${vsRhp?.avg} vsLHP avg=${vsLhp?.avg}`);
    return { vsRhp, vsLhp };
  } catch (err) {
    console.log(`[sabermetrics] fetchPlatoonSplits error for ${playerName}: ${err.message}`);
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getSabermetrics(playerName) {
  try {
    const mlbamId = await getMlbamId(playerName);
    if (!mlbamId) return null;

    const [statcast, platoon] = await Promise.all([
      fetchStatcastBatter(mlbamId, playerName),
      fetchPlatoonSplits(mlbamId, playerName),
    ]);

    if (!statcast && !platoon) {
      console.log(`[sabermetrics] No data at all for ${playerName}`);
      return null;
    }

    return { mlbamId, statcast, platoon };
  } catch (err) {
    console.log(`[sabermetrics] getSabermetrics error for ${playerName}: ${err.message}`);
    return null;
  }
}

// ─── Adjustment helpers ───────────────────────────────────────────────────────

export function getBabipMultiplier(sabermetrics) {
  if (!sabermetrics?.statcast) return 1.0;
  const { ba, xba } = sabermetrics.statcast;

  // Use actual BA vs expected BA (xBA) as regression signal
  // If actual BA is well below xBA, player is due for positive regression
  if (ba == null || xba == null) return 1.0;

  const diff = ba - xba;

  if (diff < -0.020) return 1.06;  // hitting well below expected — regression upward
  if (diff < -0.010) return 1.03;
  if (diff > 0.020)  return 0.97;  // hitting well above expected — regression downward
  if (diff > 0.010)  return 0.99;
  return 1.0;
}

export function getPlatoonMultiplier(sabermetrics, starterHand) {
  if (!sabermetrics?.platoon || !starterHand) return 1.0;

  const { vsRhp, vsLhp } = sabermetrics.platoon;
  const facingSplit   = starterHand === 'R' ? vsRhp : vsLhp;
  const oppositeSplit = starterHand === 'R' ? vsLhp : vsRhp;

  if (!facingSplit?.avg || !oppositeSplit?.avg) return 1.0;

  const ratio = facingSplit.avg / oppositeSplit.avg;
  return Math.max(0.88, Math.min(1.12, ratio));
}

export function getHardHitMultiplier(sabermetrics) {
  // Hard hit % not available on this leaderboard endpoint
  // Returning 1.0 until we source this from a different endpoint
  return 1.0;
}

export function getSabermetricMultiplier(sabermetrics, starterHand) {
  const babip   = getBabipMultiplier(sabermetrics);
  const platoon = getPlatoonMultiplier(sabermetrics, starterHand);
  const hardHit = getHardHitMultiplier(sabermetrics);

  const combined = babip * platoon * hardHit;
  return Math.max(0.85, Math.min(1.15, combined));
}

export function formatSabermetricsForPrompt(sabermetrics, starterHand) {
  if (!sabermetrics) return null;

  const lines = [];
  const s = sabermetrics.statcast;

  if (s) {
    if (s.ba != null && s.xba != null) {
      const diff   = Math.round((s.ba - s.xba) * 1000) / 1000;
      const signal = diff < -0.020 ? ' ↑ regression upside'
                   : diff > 0.020  ? ' ↓ regression risk'
                   : '';
      lines.push(`BA: ${s.ba} vs xBA: ${s.xba} (diff: ${diff > 0 ? '+' : ''}${diff}${signal})`);
    }
    if (s.xwoba != null) lines.push(`xwOBA: ${s.xwoba}`);
  }

  if (sabermetrics.platoon && starterHand) {
    const split = starterHand === 'R' ? sabermetrics.platoon.vsRhp : sabermetrics.platoon.vsLhp;
    const label = starterHand === 'R' ? 'vs RHP' : 'vs LHP';
    if (split?.avg != null) {
      lines.push(`${label}: AVG ${split.avg} | OPS ${split.ops ?? '?'} | BABIP ${split.babip ?? '?'}`);
    }
  }

  const mult = getSabermetricMultiplier(sabermetrics, starterHand);
  if (mult !== 1.0) {
    const direction = mult > 1 ? '↑' : '↓';
    lines.push(`Sabermetric adjustment: ${direction}${Math.round(Math.abs(mult - 1) * 100)}%`);
  }

  return lines.length ? lines.join(' | ') : null;
}
