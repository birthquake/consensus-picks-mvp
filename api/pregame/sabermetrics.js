// FILE LOCATION: api/pregame/sabermetrics.js
// Fetches sabermetric data from Baseball Savant (Statcast) for MLB batters.
//
// Stats fetched per batter:
//   - BABIP          : Batting Average on Balls in Play — regression signal
//   - wRC+           : Weighted Runs Created Plus — overall offensive value (100 = avg)
//   - Hard Hit %     : % of batted balls hit 95+ mph — quality of contact
//   - xBA            : Expected Batting Average based on exit velocity + launch angle
//   - Platoon splits : AVG vs LHP and vs RHP — used to adjust projection vs today's starter
//
// All data is season-level from the current year.
// Failures are handled gracefully — returns null per player on any error.
// The analyzer continues normally with null sabermetrics (no data = no adjustment).

const CURRENT_YEAR = new Date().getFullYear();

// League average baselines for context and adjustment calculations
const MLB_LEAGUE_AVG = {
  babip:       0.298,
  wrcPlus:     100,
  hardHitPct:  38.5,
  xba:         0.248,
};

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, ms = 6000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return res;
  } catch {
    clearTimeout(timer);
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

// ─── Baseball Savant player ID lookup ────────────────────────────────────────

async function getMlbamId(playerName) {
  try {
    const encoded = encodeURIComponent(playerName);
    const url     = `https://baseballsavant.mlb.com/player/search-all?q=${encoded}&type=batter`;
    const res     = await fetchWithTimeout(url, 5000);
    if (!res) return null;

    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;

    const match = data.find(p => {
      const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
      return fullName === playerName.toLowerCase();
    }) || data[0];

    return match?.id || match?.player_id || null;
  } catch {
    return null;
  }
}

// ─── Statcast season-level batting stats ─────────────────────────────────────

async function fetchStatcastBatter(mlbamId) {
  try {
    const lbUrl = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${CURRENT_YEAR}&position=&team=&min=25&csv=true`;
    const res   = await fetchWithTimeout(lbUrl, 8000);
    if (!res) return null;

    const text = await res.text();
    const rows = parseCSV(text);

    const row = rows.find(r => String(r.player_id) === String(mlbamId) || String(r.mlbam_id) === String(mlbamId));
    if (!row) return null;

    return {
      xba:         safeFloat(row.xba  || row.est_ba),
      xslg:        safeFloat(row.xslg || row.est_slg),
      xwoba:       safeFloat(row.xwoba),
      babip:       safeFloat(row.babip),
      wrcPlus:     safeFloat(row['wRC+'] || row.wrc_plus),
      hardHitPct:  safeFloat(row['Hard%'] || row.hard_hit_percent),
      avgExitVelo: safeFloat(row.avg_hit_speed || row.launch_speed),
      barrelPct:   safeFloat(row['Barrel%'] || row.barrel_batted_rate),
      kPct:        safeFloat(row['K%'] || row.strikeout_percent),
      bbPct:       safeFloat(row['BB%'] || row.walk_percent),
      pa:          safeFloat(row.pa),
    };
  } catch {
    return null;
  }
}

// ─── Platoon splits ───────────────────────────────────────────────────────────

async function fetchPlatoonSplits(mlbamId) {
  try {
    const vsRHP = `https://www.fangraphs.com/api/leaders/splits/leaders?strPlayerId=${mlbamId}&splitArr=6&statGroup=hitting&startDate=${CURRENT_YEAR}-03-01&endDate=${CURRENT_YEAR}-11-01&season=${CURRENT_YEAR}&gameType=R&stat=avg,obp,slg,woba,wrc_plus,babip&numberofrecords=1&sortDir=default&sortStat=Batting+Average&filterset=default&c=0`;
    const vsLHP = `https://www.fangraphs.com/api/leaders/splits/leaders?strPlayerId=${mlbamId}&splitArr=5&statGroup=hitting&startDate=${CURRENT_YEAR}-03-01&endDate=${CURRENT_YEAR}-11-01&season=${CURRENT_YEAR}&gameType=R&stat=avg,obp,slg,woba,wrc_plus,babip&numberofrecords=1&sortDir=default&sortStat=Batting+Average&filterset=default&c=0`;

    const [rhpRes, lhpRes] = await Promise.all([
      fetchWithTimeout(vsRHP, 5000),
      fetchWithTimeout(vsLHP, 5000),
    ]);

    const rhpData = rhpRes ? await rhpRes.json().catch(() => null) : null;
    const lhpData = lhpRes ? await lhpRes.json().catch(() => null) : null;

    const extractSplit = (data) => {
      const row = data?.data?.[0] || data?.[0] || null;
      if (!row) return null;
      return {
        avg:     safeFloat(row.AVG || row.avg),
        obp:     safeFloat(row.OBP || row.obp),
        slg:     safeFloat(row.SLG || row.slg),
        woba:    safeFloat(row.wOBA || row.woba),
        wrcPlus: safeFloat(row['wRC+'] || row.wrc_plus),
        babip:   safeFloat(row.BABIP || row.babip),
        pa:      safeFloat(row.PA || row.pa),
      };
    };

    const vsRhp = extractSplit(rhpData);
    const vsLhp = extractSplit(lhpData);

    if (!vsRhp && !vsLhp) return null;

    return { vsRhp, vsLhp };
  } catch {
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getSabermetrics(playerName) {
  try {
    const mlbamId = await getMlbamId(playerName);
    if (!mlbamId) return null;

    const [statcast, platoon] = await Promise.all([
      fetchStatcastBatter(mlbamId),
      fetchPlatoonSplits(mlbamId),
    ]);

    if (!statcast && !platoon) return null;

    return { mlbamId, statcast, platoon };
  } catch {
    return null;
  }
}

// ─── Adjustment helpers ───────────────────────────────────────────────────────

export function getBabipMultiplier(sabermetrics) {
  if (!sabermetrics?.statcast) return 1.0;
  const { babip, xba } = sabermetrics.statcast;
  if (babip == null) return 1.0;

  const expectedBabip = xba != null ? xba + 0.05 : MLB_LEAGUE_AVG.babip;
  const diff = babip - expectedBabip;

  if (diff < -0.020) return 1.06;
  if (diff < -0.010) return 1.03;
  if (diff > 0.020)  return 0.97;
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
  if (!sabermetrics?.statcast?.hardHitPct) return 1.0;
  const { hardHitPct } = sabermetrics.statcast;
  const diff = hardHitPct - MLB_LEAGUE_AVG.hardHitPct;

  if (diff > 10)  return 1.05;
  if (diff > 5)   return 1.03;
  if (diff < -10) return 0.95;
  if (diff < -5)  return 0.97;
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
    if (s.babip != null)       lines.push(`BABIP: ${s.babip} (lg avg ${MLB_LEAGUE_AVG.babip})`);
    if (s.xba != null)         lines.push(`xBA: ${s.xba}`);
    if (s.wrcPlus != null)     lines.push(`wRC+: ${s.wrcPlus} (100=avg)`);
    if (s.hardHitPct != null)  lines.push(`Hard Hit%: ${s.hardHitPct}% (lg avg ${MLB_LEAGUE_AVG.hardHitPct}%)`);
    if (s.barrelPct != null)   lines.push(`Barrel%: ${s.barrelPct}%`);
  }

  if (sabermetrics.platoon && starterHand) {
    const split = starterHand === 'R' ? sabermetrics.platoon.vsRhp : sabermetrics.platoon.vsLhp;
    const label = starterHand === 'R' ? 'vs RHP' : 'vs LHP';
    if (split?.avg != null) {
      lines.push(`${label}: AVG ${split.avg} | wRC+ ${split.wrcPlus ?? '?'} | BABIP ${split.babip ?? '?'}`);
    }
  }

  const mult = getSabermetricMultiplier(sabermetrics, starterHand);
  if (mult !== 1.0) {
    const direction = mult > 1 ? '↑' : '↓';
    lines.push(`Sabermetric adjustment: ${direction}${Math.round(Math.abs(mult - 1) * 100)}%`);
  }

  return lines.length ? lines.join(' | ') : null;
}
