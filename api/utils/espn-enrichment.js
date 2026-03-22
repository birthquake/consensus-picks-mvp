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
  // Pre-fetch team rosters once per sport — cache them so each player
  // lookup doesn't re-fetch all 30 team rosters independently.
  const rosterCache = {};

  // Process picks sequentially to avoid ESPN rate limiting on large parlays.
  const results = [];
  for (const pick of picks) {
    try {
      const result = await enrichSinglePick(pick, gameDate, rosterCache);
      results.push(result);
    } catch (err) {
      console.warn(`[espn-enrichment] Failed to enrich ${pick.player}:`, err.message);
      results.push({ player: pick.player, error: err.message });
    }
  }
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

async function enrichSinglePick(pick, gameDate, rosterCache = {}) {
  const sport = normalizeSport(pick.sport);
  const config = SPORT_CONFIG[sport];
  if (!config) return { player: pick.player, error: `Unsupported sport: ${sport}` };

  // Step 1: Find the ESPN athlete ID by searching
  const athleteInfo = await findAthlete(config, pick.player, rosterCache);
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

async function findAthlete(config, playerName, rosterCache = {}) {
  // Strategy 1: roster-based lookup with caching
  // Cache key per sport so we only fetch rosters once per enrichPicks() call
  const athlete = await findAthleteViaRosters(config, playerName, rosterCache);
  if (athlete) return athlete;

  // Strategy 2: core athletes list fallback
  return findAthleteViaAthleteSearch(config, playerName);
}

async function findAthleteViaRosters(config, playerName, rosterCache = {}) {
  const cacheKey = `${config.sport}:${config.league}`;

  // Fetch and cache all rosters for this sport once per enrichPicks call
  if (!rosterCache[cacheKey]) {
    const teamsUrl = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/teams?limit=50`;
    const teamsData = await fetchWithTimeout(teamsUrl);
    if (!teamsData) return null;

    const teamList = teamsData.sports?.[0]?.leagues?.[0]?.teams || teamsData.teams || [];
    if (teamList.length === 0) return null;

    // Fetch all rosters sequentially and flatten into one player list
    const allPlayers = [];
    for (const t of teamList) {
      const teamId = t.team?.id || t.id;
      if (!teamId) continue;
      const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/teams/${teamId}/roster`;
      const rosterData = await fetchWithTimeout(rosterUrl, 4000);
      if (!rosterData) continue;

      const groups = rosterData.athletes || [];
      for (const group of groups) {
        const items = group.items || group.athletes || [];
        allPlayers.push(...items.map(p => ({
          id: p.id,
          displayName: p.displayName,
          fullName: p.fullName,
          uid: p.uid,
        })));
      }
    }
    rosterCache[cacheKey] = allPlayers;
    console.log(`[espn-enrichment] Cached ${allPlayers.length} players for ${cacheKey}`);
  }

  const allPlayers = rosterCache[cacheKey];
  const best = bestNameMatch(allPlayers, playerName);
  if (!best) return null;

  return {
    id: best.id || best.uid?.split('~a:')?.[1],
    displayName: best.displayName || best.fullName,
  };
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
  // Strategy: fetch the athlete's recent event log to get game IDs,
  // then pull each game summary (which we know returns inline box scores).

  // Step 1: Get recent event IDs from the athlete eventlog
  const eventlogUrl = `https://sports.core.api.espn.com/v2/sports/${config.sport}/leagues/${config.league}/athletes/${athleteId}/eventlog`;
  const eventlogData = await fetchWithTimeout(eventlogUrl, 6000);
  if (!eventlogData) return null;

  // eventlog shape: { events: { $ref: "..." } } OR { items: [...] }
  // Try to get event $refs — each item has an event.$ref and a statistics.$ref
  const items = eventlogData?.events?.items || eventlogData?.items || [];
  if (items.length === 0) return null;

  // Filter to only played games (played: true), take last 5, most recent first
  const playedItems = items.filter(item => item.played === true || item.played === undefined);
  const recentItems = playedItems.slice(-5).reverse();

  if (recentItems.length === 0) return null;

  // Step 2: Fetch summaries sequentially to avoid rate limiting
  const results = [];
  for (const item of recentItems) {
    const result = await extractStatFromEventItem(config, item, athleteId, statKey);
    if (result !== null) results.push(result);
  }

  return results.length > 0 ? results : null;
}

async function extractStatFromEventItem(config, item, athleteId, statKey) {
  try {
    // Get event ID from inline id or $ref URL
    let eventId = item.event?.id;
    if (!eventId && item.event?.$ref) {
      const match = item.event.$ref.match(/events\/(\d+)/);
      eventId = match?.[1];
    }
    if (!eventId) return null;

    // Fetch game summary — same endpoint used for result grading
    const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/summary?event=${eventId}`;
    const summary = await fetchWithTimeout(summaryUrl, 5000);
    if (!summary?.boxscore?.players) return null;

    // Pull date from header
    const date = summary?.header?.competitions?.[0]?.date
      || summary?.gameInfo?.date
      || null;

    // Pull opponent — find the competitor whose team ID != the player's team
    const playerTeamId = String(item.teamId || '');
    const competitors = summary?.header?.competitions?.[0]?.competitors || [];
    const opponentComp = competitors.find(c => String(c.team?.id) !== playerTeamId);
    const opponent = opponentComp?.team?.abbreviation || opponentComp?.team?.shortDisplayName || null;

    const value = extractPlayerStatFromSummary(summary, athleteId, statKey);

    return { eventId, date, opponent, value };
  } catch {
    return null;
  }
}

function extractPlayerStatFromSummary(summary, athleteId, statKey) {
  const playerGroups = summary?.boxscore?.players || [];

  for (const group of playerGroups) {
    const statsBlock = group.statistics?.[0];
    if (!statsBlock) continue;

    const keys = statsBlock.keys || [];

    // Find stat index — try direct match, then partial
    let statIdx = keys.findIndex(k => k.toLowerCase() === statKey.toLowerCase());
    if (statIdx === -1) {
      statIdx = keys.findIndex(k => k.toLowerCase().includes(statKey.toLowerCase()));
    }
    if (statIdx === -1) continue;

    // Find the athlete by ID
    const athletes = statsBlock.athletes || [];
    const athlete = athletes.find(a => String(a.athlete?.id) === String(athleteId));
    if (!athlete || !athlete.stats?.length) continue;

    const raw = athlete.stats[statIdx];
    if (raw == null || raw === '') return null;

    // Handle fraction format "8-14" → return made count
    const s = String(raw).trim();
    if (s.includes('-') && !s.startsWith('-')) {
      return parseInt(s.split('-')[0], 10) || null;
    }
    if (s.startsWith('+')) return parseFloat(s.slice(1)) || null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  return null;
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
  const today = gameDate ? gameDate.replace(/-/g, '') : formatDate(new Date());
  const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard?dates=${today}`;
  const data = await fetchWithTimeout(url);
  if (!data?.events?.length) return null;

  // Single game — easy
  if (data.events.length === 1) {
    return describeGame(data.events[0]);
  }

  // Multiple games — find the one containing this athlete.
  // Use the athlete eventlog to get their current team ID.
  const eventlogUrl = `https://sports.core.api.espn.com/v2/sports/${config.sport}/leagues/${config.league}/athletes/${athleteId}/eventlog`;
  const eventlog = await fetchWithTimeout(eventlogUrl, 4000);
  const teamId = eventlog?.teams?.[0]?.id
    || eventlog?.events?.items?.slice(-1)[0]?.teamId
    || null;

  if (!teamId) {
    // Can't determine team — return all games as context
    return data.events.map(e => e.shortName).join(' | ');
  }

  // Find the game where one of the competitors matches this team ID
  const game = data.events.find(e =>
    e.competitions?.[0]?.competitors?.some(c => String(c.team?.id) === String(teamId))
  );

  if (!game) return data.events.map(e => e.shortName).join(' | ');
  return describeGame(game, teamId);
}

function describeGame(event, teamId) {
  const comps = event.competitions?.[0]?.competitors || [];
  if (!teamId || comps.length < 2) return event.shortName || event.name;
  const opp = comps.find(c => String(c.team?.id) !== String(teamId));
  const isHome = comps.find(c => String(c.team?.id) === String(teamId))?.homeAway === 'home';
  const oppName = opp?.team?.abbreviation || opp?.team?.shortDisplayName || '?';
  return isHome ? `vs ${oppName}` : `@ ${oppName}`;
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
