// FILE LOCATION: api/utils/espn-enrichment.js
// Fetches real ESPN context for a set of picks BEFORE Claude analyzes them.
// Called during bet slip submission so Claude has actual data, not guesses.
//
// Per pick, we fetch:
//   - Player's last 5 game stats for the relevant stat (game log)
//   - Current injury status
//   - Tonight's opponent + their defensive rank for that stat (if available)
//
// All fetches run in parallel per pick, with a 5s timeout per call.
// If any fetch fails we degrade gracefully — Claude still runs, just with
// less context for that pick.

const SPORT_CONFIG = {
  NFL:  { sport: 'football',   league: 'nfl' },
  NBA:  { sport: 'basketball', league: 'nba' },
  MLB:  { sport: 'baseball',   league: 'mlb' },
  NHL:  { sport: 'hockey',     league: 'nhl' },
  NCAAF:{ sport: 'football',   league: 'college-football' },
  NCAAB:{ sport: 'basketball', league: 'mens-college-basketball' },
};

// Stat label → ESPN athlete gamelog stat key
const GAMELOG_STAT_MAP = {
  // NBA
  'points':              'points',
  'pts':                 'points',
  'rebounds':            'rebounds',
  'reb':                 'rebounds',
  'assists':             'assists',
  'ast':                 'assists',
  'steals':              'steals',
  'blocks':              'blocks',
  'three pointers':      'threePointFieldGoalsMade',
  'threes':              'threePointFieldGoalsMade',
  'three pointers made': 'threePointFieldGoalsMade',
  // NFL
  'passing yards':       'passingYards',
  'rushing yards':       'rushingYards',
  'receiving yards':     'receivingYards',
  'receptions':          'receptions',
  'touchdowns':          'passingTouchdowns',
  'passing touchdowns':  'passingTouchdowns',
  // NHL
  'shots on goal':       'shots',
  'goals':               'goals',
  // MLB
  'strikeouts':          'strikeouts',
  'hits':                'hits',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enrich a set of picks with real ESPN data.
 * Returns an array parallel to `picks`, each entry containing whatever
 * context we could fetch. Failures are caught and logged per pick.
 *
 * @param {Array} picks - Extracted picks from bet slip
 * @returns {Array<object>} enrichments, one per pick
 */
export async function enrichPicks(picks, gameDate) {
  const results = await Promise.all(
    picks.map(pick => enrichSinglePick(pick, gameDate).catch(err => {
      console.warn(`[espn-enrichment] Failed to enrich ${pick.player}:`, err.message);
      return { player: pick.player, error: err.message };
    }))
  );
  return results;
}

/**
 * Format enrichment data as a compact string block for Claude's prompt.
 */
export function formatEnrichmentForPrompt(enrichments) {
  if (!enrichments || enrichments.length === 0) return '';

  const lines = ['ESPN LIVE CONTEXT (use this data in your analysis):'];

  for (const e of enrichments) {
    if (e.error || (!e.recentForm && !e.injuryStatus)) {
      lines.push(`\n${e.player}: Context unavailable`);
      continue;
    }

    lines.push(`\n${e.playerFullName || e.player}:`);

    if (e.injuryStatus && e.injuryStatus !== 'Active') {
      lines.push(`  ⚠️  INJURY STATUS: ${e.injuryStatus}`);
    }

    if (e.recentForm && e.recentForm.length > 0) {
      const statLabel = e.statLabel || 'stat';
      const values = e.recentForm.map(g => g.value ?? 'DNP');
      const avg = average(e.recentForm.filter(g => g.value !== null).map(g => g.value));
      lines.push(`  Last ${e.recentForm.length} games (${statLabel}): ${values.join(', ')} → avg ${avg}`);

      // Trend signal
      if (e.recentForm.length >= 3) {
        const recent2 = average(e.recentForm.slice(0, 2).map(g => g.value ?? 0));
        const older = average(e.recentForm.slice(2).map(g => g.value ?? 0));
        if (recent2 > older * 1.15) lines.push(`  📈 Trending UP in last 2 games`);
        if (recent2 < older * 0.85) lines.push(`  📉 Trending DOWN in last 2 games`);
      }
    }

    if (e.opponent) {
      lines.push(`  Tonight vs: ${e.opponent}`);
    }

    if (e.espnId) {
      lines.push(`  ESPN ID: ${e.espnId}`);
    }
  }

  return lines.join('\n');
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function enrichSinglePick(pick, gameDate) {
  const sport = normalizeSport(pick.sport);
  const config = SPORT_CONFIG[sport];
  if (!config) return { player: pick.player, error: `Unsupported sport: ${sport}` };

  // Step 1: Find the ESPN athlete ID by searching
  const athleteInfo = await findAthlete(config, pick.player);
  if (!athleteInfo) {
    return { player: pick.player, error: 'Athlete not found on ESPN' };
  }

  const statKey = normalizeStatKey(pick.stat);

  // Step 2: Fetch gamelog + injury in parallel
  const [recentForm, injuryStatus, opponent] = await Promise.all([
    fetchRecentForm(config, athleteInfo.id, statKey).catch(() => null),
    fetchInjuryStatus(config, athleteInfo.id).catch(() => 'Unknown'),
    fetchTonightsOpponent(config, athleteInfo.id, gameDate).catch(() => null),
  ]);

  return {
    player: pick.player,
    playerFullName: athleteInfo.displayName,
    espnId: athleteInfo.id,
    statLabel: pick.stat,
    statKey,
    recentForm,
    injuryStatus,
    opponent,
  };
}

async function findAthlete(config, playerName) {
  // Use the site search API for fast name lookup
  const query = encodeURIComponent(playerName);
  const url = `https://site.web.api.espn.com/apis/search/v2?query=${query}&sport=${config.sport}&limit=5`;

  const data = await fetchWithTimeout(url);
  if (!data) return null;

  // Search results come back in a "results" array of typed buckets
  const athleteBucket = data.results?.find(r =>
    r.type === 'athlete' || r.displayName?.toLowerCase().includes('athlete')
  );

  const candidates = athleteBucket?.contents || data.athletes || [];

  if (candidates.length === 0) {
    // Fallback: try the core athletes endpoint with a name filter
    return findAthleteViaCore(config, playerName);
  }

  // Pick the best name match
  const best = bestNameMatch(candidates, playerName);
  if (!best) return null;

  return {
    id: best.id || best.athleteId,
    displayName: best.displayName || best.name,
  };
}

async function findAthleteViaCore(config, playerName) {
  // Core athletes list — paginated, search first 200 active players
  const url = `https://sports.core.api.espn.com/v2/sports/${config.sport}/leagues/${config.league}/athletes?limit=200&active=true`;
  const data = await fetchWithTimeout(url);
  if (!data?.items) return null;

  // Items are $ref links — we need to load a sample and name-match
  // This is expensive so we limit to 50 refs and search in parallel batches
  const refs = (data.items || []).slice(0, 50).map(i => i.$ref).filter(Boolean);
  const athletes = await fetchAthleteRefs(refs);
  const best = bestNameMatch(athletes, playerName);
  return best ? { id: best.id, displayName: best.displayName } : null;
}

async function fetchAthleteRefs(refs) {
  const batchSize = 10;
  const results = [];
  for (let i = 0; i < refs.length; i += batchSize) {
    const batch = refs.slice(i, i + batchSize);
    const fetched = await Promise.all(
      batch.map(ref => fetchWithTimeout(ref).catch(() => null))
    );
    results.push(...fetched.filter(Boolean));
  }
  return results;
}

async function fetchRecentForm(config, athleteId, statKey) {
  // Use the v3 statisticslog for enriched per-game data
  const url = `https://sports.core.api.espn.com/v3/sports/${config.sport}/${config.league}/athletes/${athleteId}/statisticslog`;
  const data = await fetchWithTimeout(url);
  if (!data?.entries) return null;

  // Each entry is a game — take the last 5, most recent first
  const games = (data.entries || [])
    .filter(e => e.statistics)
    .slice(0, 5);

  return games.map(entry => {
    const stats = entry.statistics || {};
    // The v3 statisticslog stores splits — find the "game" split
    const gameSplit = Array.isArray(stats) ? stats : (stats.splits || []);
    const value = extractStatFromSplit(gameSplit, statKey);
    return {
      date: entry.eventDate || entry.date,
      opponent: entry.opponent?.displayName || null,
      value,
    };
  }).filter(g => g.value !== undefined);
}

async function fetchInjuryStatus(config, athleteId) {
  const url = `https://sports.core.api.espn.com/v2/sports/${config.sport}/leagues/${config.league}/athletes/${athleteId}`;
  const data = await fetchWithTimeout(url);
  if (!data) return 'Unknown';

  // Status can be in different places depending on the sport
  const status = data.status?.type?.description
    || data.injuryStatus
    || data.status?.name
    || 'Active';

  return status;
}

async function fetchTonightsOpponent(config, athleteId, gameDate) {
  // Check the scoreboard for the actual game date
  const today = gameDate ? gameDate.replace(/-/g, '') : formatDate(new Date());
  const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard?dates=${today}`;
  const data = await fetchWithTimeout(url);
  if (!data?.events) return null;

  // Find which event contains this athlete's team
  // We don't have team ID so we'll just return the game names for Claude to use
  if (data.events.length === 0) return null;
  if (data.events.length === 1) {
    const e = data.events[0];
    return e.name || e.shortName;
  }

  return `${data.events.length} games today`;
}

// ─── Stat extraction from v3 statisticslog ────────────────────────────────────

function extractStatFromSplit(splits, statKey) {
  if (!splits || !statKey) return null;

  // v3 statisticslog format varies — try multiple shapes
  for (const split of (Array.isArray(splits) ? splits : [splits])) {
    const categories = split.categories || split.stats || [];
    for (const cat of categories) {
      const stats = cat.stats || cat.values || [];
      for (const stat of stats) {
        if (
          stat.name?.toLowerCase() === statKey.toLowerCase() ||
          stat.abbreviation?.toLowerCase() === statKey.toLowerCase()
        ) {
          return stat.value ?? parseFloat(stat.displayValue) ?? null;
        }
      }
    }
  }
  return null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function bestNameMatch(candidates, searchName) {
  if (!candidates?.length || !searchName) return null;
  const search = normalizeName(searchName);

  let best = null;
  let bestScore = 0;

  for (const c of candidates) {
    const name = normalizeName(c.displayName || c.name || c.fullName || '');
    const score = nameScore(search, name);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return bestScore >= 0.55 ? best : null;
}

function normalizeName(name) {
  return (name || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function nameScore(a, b) {
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;
  const aT = new Set(a.split(' '));
  const bT = new Set(b.split(' '));
  const inter = [...aT].filter(t => bT.has(t)).length;
  return inter / new Set([...aT, ...bT]).size;
}

function normalizeStatKey(statLabel) {
  if (!statLabel) return '';
  return GAMELOG_STAT_MAP[statLabel.toLowerCase().trim()] || statLabel.toLowerCase();
}

function normalizeSport(sport) {
  if (!sport) return 'NBA';
  const s = sport.toUpperCase().trim();
  if (s.includes('NFL') || s.includes('FOOTBALL')) return 'NFL';
  if (s.includes('NBA') || s.includes('BASKETBALL')) return 'NBA';
  if (s.includes('MLB') || s.includes('BASEBALL')) return 'MLB';
  if (s.includes('NHL') || s.includes('HOCKEY')) return 'NHL';
  return s;
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function average(arr) {
  if (!arr?.length) return 'N/A';
  const sum = arr.reduce((a, b) => a + (b || 0), 0);
  return (sum / arr.length).toFixed(1);
}
