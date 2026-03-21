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
  'shots':               'shots',
  'goals':               'goals',
  'saves':               'saves',
  'assists':             'assists',
  'points':              'points',
  'hits':                'hits',
  'blocked shots':       'blockedShots',
  'time on ice':         'timeOnIce',
  'penalty minutes':     'penaltyMinutes',
  'power play goals':    'powerPlayGoals',
  // MLB - pitchers
  'strikeouts':          'strikeouts',
  'earned runs':         'earnedRuns',
  'walks':               'walks',
  'innings pitched':     'inningsPitched',
  'hits allowed':        'hitsAllowed',
  // MLB - batters
  'hits':                'hits',
  'home runs':           'homeRuns',
  'rbis':                'RBI',
  'rbi':                 'RBI',
  'runs':                'runs',
  'total bases':         'totalBases',
  'stolen bases':        'stolenBases',
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
  // Strategy 1: site API teams endpoint — fetches all teams then searches
  // rosters. Each team roster call returns full player objects with IDs inline,
  // no ref-following needed. We run team fetches in parallel batches.
  const athlete = await findAthleteViaRosters(config, playerName);
  if (athlete) return athlete;

  // Strategy 2: scoreboard athletes — pull today's scoreboard and check
  // the athlete IDs embedded in the boxscore (faster for active game days)
  return findAthleteViaAthleteSearch(config, playerName);
}

async function findAthleteViaRosters(config, playerName) {
  // Get all teams for this league
  const teamsUrl = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/teams?limit=50`;
  const teamsData = await fetchWithTimeout(teamsUrl);
  if (!teamsData) return null;

  // Extract team list — shape differs slightly between sports
  const sports = teamsData.sports?.[0]?.leagues?.[0]?.teams || teamsData.teams || [];
  if (sports.length === 0) return null;

  // Search rosters in parallel batches of 6 teams
  const batchSize = 6;
  for (let i = 0; i < sports.length; i += batchSize) {
    const batch = sports.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(t => searchTeamRoster(config, t.team?.id || t.id, playerName))
    );
    const found = results.find(r => r !== null);
    if (found) return found;
  }
  return null;
}

async function searchTeamRoster(config, teamId, playerName) {
  if (!teamId) return null;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/teams/${teamId}/roster`;
  const data = await fetchWithTimeout(url);
  if (!data) return null;

  // Roster shape: data.athletes[] (array of position groups, each with items[])
  // OR data.roster[] flat list depending on sport
  const allPlayers = [];

  if (Array.isArray(data.athletes)) {
    for (const group of data.athletes) {
      const items = group.items || group.athletes || [];
      allPlayers.push(...items);
    }
  } else if (Array.isArray(data.roster)) {
    allPlayers.push(...data.roster);
  }

  const best = bestNameMatch(allPlayers, playerName);
  if (!best) return null;

  return {
    id: best.id || best.uid?.split('~a:')?.[1],
    displayName: best.displayName || best.fullName,
  };
}

async function findAthleteViaAthleteSearch(config, playerName) {
  // Last resort: use the athlete search endpoint with active=true
  // Returns $ref items but we can extract IDs from the ref URL directly
  const url = `https://sports.core.api.espn.com/v2/sports/${config.sport}/leagues/${config.league}/athletes?limit=1000&active=true`;
  const data = await fetchWithTimeout(url, 8000);
  if (!data?.items) return null;

  // Extract athlete IDs directly from $ref URLs — no extra fetches needed
  // Ref format: .../athletes/4278073?lang=...
  const candidates = (data.items || []).map(item => {
    const ref = item.$ref || '';
    const match = ref.match(/athletes\/(\d+)/);
    return match ? { id: match[1], $ref: ref } : null;
  }).filter(Boolean);

  // We still need names — fetch in small batches until we find a match
  const batchSize = 20;
  for (let i = 0; i < Math.min(candidates.length, 200); i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const athletes = await Promise.all(
      batch.map(c => fetchWithTimeout(c.$ref).catch(() => null))
    );
    const valid = athletes.filter(Boolean);
    const best = bestNameMatch(valid, playerName);
    if (best) return { id: best.id, displayName: best.displayName };
  }

  return null;
}

async function fetchRecentForm(config, athleteId, statKey) {
  // Use the core v2 statisticslog — confirmed working endpoint
  const url = `https://sports.core.api.espn.com/v2/sports/${config.sport}/leagues/${config.league}/athletes/${athleteId}/statisticslog`;
  const data = await fetchWithTimeout(url, 6000);
  if (!data) return null;

  // Gamelog shape: data.categories[] with labels/names arrays + data.events{}
  // Each event key maps to a stats array positionally aligned to categories
  const categories = data.categories || [];
  if (categories.length === 0) return null;

  // Find which category contains our stat and which index within it
  let statCategoryIdx = -1;
  let statIdx = -1;

  for (let ci = 0; ci < categories.length; ci++) {
    const cat = categories[ci];
    const names = cat.names || cat.labels || [];
    const keys  = cat.keys  || names;
    for (let si = 0; si < keys.length; si++) {
      const key = (keys[si] || '').toLowerCase();
      const label = (names[si] || '').toLowerCase();
      if (key === statKey.toLowerCase() || label === statKey.toLowerCase() ||
          key.startsWith(statKey.toLowerCase()) || label.startsWith(statKey.toLowerCase())) {
        statCategoryIdx = ci;
        statIdx = si;
        break;
      }
    }
    if (statIdx !== -1) break;
  }

  if (statIdx === -1) {
    // stat not in gamelog categories — try abbreviation match
    for (let ci = 0; ci < categories.length; ci++) {
      const cat = categories[ci];
      const abbrevs = cat.abbreviations || cat.labels || [];
      for (let si = 0; si < abbrevs.length; si++) {
        if ((abbrevs[si] || '').toLowerCase() === statKey.toLowerCase()) {
          statCategoryIdx = ci;
          statIdx = si;
          break;
        }
      }
      if (statIdx !== -1) break;
    }
  }

  if (statIdx === -1) return null;

  // Events are keyed by event ID — get last 5, most recent first
  const events = data.events || {};
  const eventIds = Object.keys(events);
  if (eventIds.length === 0) return null;

  // Each event has a stats array per category — pull ours
  const recentGames = eventIds.slice(-5).reverse();

  return recentGames.map(eventId => {
    const event = events[eventId];
    const catStats = event?.stats?.[statCategoryIdx];
    const raw = Array.isArray(catStats) ? catStats[statIdx] : null;
    const value = raw != null ? parseStatValue(String(raw)) : null;
    return {
      date: event?.gameDate || event?.date || null,
      opponent: event?.opponent?.displayName || event?.atVs || null,
      value,
    };
  }).filter(g => g.value !== null);
}

// Parse a raw gamelog stat value — handles "8-14" fractions, "+5", plain numbers
function parseStatValue(raw) {
  if (!raw || raw === '--' || raw === '-') return null;
  const s = String(raw).trim();
  if (s.includes('-') && !s.startsWith('-')) {
    // "made-attempted" fraction — return made count
    const made = parseInt(s.split('-')[0], 10);
    return isNaN(made) ? null : made;
  }
  if (s.startsWith('+')) return parseFloat(s.slice(1)) || null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
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
  if (s.includes('NHL') || s.includes('HOCKEY') || s.includes('ICE')) return 'NHL';
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
