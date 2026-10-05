// FILE LOCATION: lib/grading-logic.js
// Pure grading-decision logic, extracted out of api/cron/fetch-game-results.js
// so it can be unit tested without Firestore or network I/O. Each function
// takes plain data (a pick + an already-fetched lookup result) and returns a
// decision describing what to do — the caller applies it to Firestore. Keeping
// this logic pure and tested directly is what would have caught the three
// grading bugs fixed on 2026-10-04/05 (a null projection silently auto-grading
// as a hit, chief among them) before they ever reached production.

// Maps a pick's display stat label to analyze-nfl.js's internal projection
// key — needed because NFL nests projections per stat (one player can have
// multiple tracked stats, e.g. a QB's passing AND rushing yards), unlike
// NBA/MLB/NHL's single flat {conservative, blended, aggressive} object per
// player. See resolvePlayerProjection below.
const NFL_STAT_LABEL_TO_KEY = {
  'passing yards':   'passingYards',
  'rushing yards':   'rushingYards',
  'receiving yards': 'receivingYards',
};

/**
 * Resolves the correct projection object for a pick at save time.
 *
 * `projections[player]` is a flat {conservative, blended, aggressive, ...}
 * object for NBA/MLB/NHL, but a nested {passingYards: {...}, rushingYards:
 * {...}, ...} object for NFL — saving blindly assumed the flat shape, so
 * every NFL pick's projection silently saved as all-null (playerProj.blended
 * was always undefined), which in turn made every "Over" pick auto-grade as
 * a hit later (see determineHalftimeGradeAction above). Unwraps to the
 * specific stat's projection when the flat shape isn't present.
 */
export function resolvePlayerProjection(projections, player, stat) {
  let playerProj = projections?.[player] || null;
  if (playerProj && !('blended' in playerProj)) {
    const statKey = NFL_STAT_LABEL_TO_KEY[(stat || '').toLowerCase().trim()];
    if (statKey && playerProj[statKey]) playerProj = playerProj[statKey];
  }
  return playerProj;
}

export function computeHoursSinceGame(gameDate, now = new Date()) {
  // Use end-of-day (23:59) as the reference point so picks from any game on a
  // given date pass this gate once the day is over, rather than at the raw
  // gameDate timestamp (often midnight UTC, which would gate too early).
  const pickDate = new Date(gameDate);
  pickDate.setHours(23, 59, 0, 0);
  return (now - pickDate) / 3600000;
}

/**
 * Decides what to do with a pending halftime (player-prop) pick given the
 * ESPN lookup result (the shape getPlayerStatForGame returns).
 *
 * Returns one of:
 *   { action: 'skip' }
 *   { action: 'void', grade_note, actual_value? }
 *   { action: 'grade', status: 'hit'|'miss', hit, actual_value,
 *     projection_error, projection_error_pct, game_status_at_grade }
 */
export function determineHalftimeGradeAction(pick, result, hoursSinceGame) {
  if (hoursSinceGame < 4) return { action: 'skip' };

  if (!result.found || result.value === null) {
    // Normal case: the game resolved but the stat/player didn't match — safe
    // to void once we're confident the game is really over.
    // Fallback: the game itself could never be located at all (bad gameDate
    // beyond what the ±1-day search covers, a name ESPN doesn't carry, etc.)
    // — gameStatus never becomes 'final' in that case, so without this it
    // stays pending forever regardless of how old it gets. 7 days is enough
    // that this isn't about short grading delays.
    if ((result.gameStatus === 'final' && hoursSinceGame > 12) || hoursSinceGame > 168) {
      return {
        action: 'void',
        grade_note: result.error || (hoursSinceGame > 168 ? 'Unresolvable after 7 days' : 'Stat not found after 12h'),
      };
    }
    return { action: 'skip' };
  }

  if (result.gameStatus !== 'final') return { action: 'skip' };

  const actualValue = result.value;

  // Void if player DNP — 0 minutes played. Note: getPlayerStatForGame does
  // not currently return a `minutes` field, so this branch is presently
  // unreachable — kept for forward compatibility and documented by a test
  // that asserts as much, rather than silently relying on dead code.
  if (result.minutes !== undefined && result.minutes === 0) {
    return { action: 'void', grade_note: 'DNP — 0 minutes played', actual_value: 0 };
  }

  // Also void if the stat value is suspiciously 0 for a starter-level player
  // who had a projection above threshold (suggests DNP or injury scratch).
  const projection = pick.projection?.blended || pick.projection?.conservative || 0;
  const dnpThreshold = (pick.sport === 'mlb' || pick.league === 'mlb') ? 0.3 : 8;
  if (actualValue === 0 && projection > dnpThreshold) {
    return { action: 'void', grade_note: 'Likely DNP — 0 actual vs high projection suggests scratch', actual_value: 0 };
  }

  // A missing projection must never silently resolve to a hit — see the
  // module comment. With no real projection there's nothing to grade against.
  if (pick.projection?.blended == null) {
    return { action: 'void', grade_note: 'No projection recorded — ungradeable' };
  }

  const blended = pick.projection.blended;
  const hit = pick.direction === 'Over' ? actualValue > blended : actualValue < blended;
  const projError = Math.round((actualValue - blended) * 10) / 10;
  const projErrorPct = blended > 0 ? Math.round(((actualValue - blended) / blended) * 100) : null;

  return {
    action: 'grade',
    status: hit ? 'hit' : 'miss',
    hit,
    actual_value: actualValue,
    projection_error: projError,
    projection_error_pct: projErrorPct,
    game_status_at_grade: result.gameStatus,
  };
}

/**
 * Decides what to do with a pending moneyline (game-outcome) pick given an
 * already-fetched ESPN game summary.
 *
 * Returns one of:
 *   { action: 'skip' }
 *   { action: 'void', grade_note }
 *   { action: 'grade', status: 'hit'|'miss', hit, actual_winner }
 */
export function determineMoneylineGradeAction(pick, summary) {
  if (!summary) return { action: 'skip' };

  const comp = summary.header?.competitions?.[0];
  const statusType = comp?.status?.type;

  if (!statusType?.completed) return { action: 'skip' };

  const name = statusType.name || '';
  if (name.includes('POSTPONED') || name.includes('CANCELED') || name.includes('CANCELLED')) {
    return { action: 'void', grade_note: 'Game postponed/cancelled' };
  }

  const home = comp?.competitors?.find(c => c.homeAway === 'home');
  const away = comp?.competitors?.find(c => c.homeAway === 'away');
  const homeScore = parseInt(home?.score, 10);
  const awayScore = parseInt(away?.score, 10);

  if (isNaN(homeScore) || isNaN(awayScore)) return { action: 'skip' };

  if (homeScore === awayScore) {
    return { action: 'void', grade_note: 'Unresolvable tie' };
  }

  const winner = homeScore > awayScore ? home : away;
  const actualWinnerAbbrev = winner?.team?.abbreviation;
  const hit = actualWinnerAbbrev === pick.teamAbbrev;

  return {
    action: 'grade',
    status: hit ? 'hit' : 'miss',
    hit,
    actual_winner: actualWinnerAbbrev,
  };
}
