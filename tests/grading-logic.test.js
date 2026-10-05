// FILE LOCATION: tests/grading-logic.test.js
// Regression tests for the grading-decision bugs fixed 2026-10-04/05: a
// missing projection silently auto-grading as a hit, and NFL's nested
// per-stat projection shape saving as all-null.

import { describe, it, expect } from 'vitest';
import {
  determineHalftimeGradeAction,
  determineMoneylineGradeAction,
  resolvePlayerProjection,
  computeHoursSinceGame,
} from '../lib/grading-logic.js';

describe('determineHalftimeGradeAction', () => {
  const basePick = { direction: 'Over', sport: 'nfl', league: 'nfl', projection: { blended: 250 } };

  it('REGRESSION: never auto-hits an Over pick with no projection recorded', () => {
    const pick = { ...basePick, projection: {} };
    const result = { found: true, value: 300, gameStatus: 'final' };
    const decision = determineHalftimeGradeAction(pick, result, 24);
    expect(decision.action).toBe('void');
    expect(decision.grade_note).toMatch(/no projection/i);
  });

  it('REGRESSION: never auto-hits an Under pick with no projection recorded', () => {
    const pick = { ...basePick, direction: 'Under', projection: {} };
    const result = { found: true, value: 5, gameStatus: 'final' };
    const decision = determineHalftimeGradeAction(pick, result, 24);
    expect(decision.action).toBe('void');
  });

  it('grades a real Over hit correctly', () => {
    const result = { found: true, value: 300, gameStatus: 'final' };
    const decision = determineHalftimeGradeAction(basePick, result, 24);
    expect(decision).toMatchObject({ action: 'grade', status: 'hit', hit: true, actual_value: 300 });
  });

  it('grades a real Over miss correctly', () => {
    const result = { found: true, value: 200, gameStatus: 'final' };
    const decision = determineHalftimeGradeAction(basePick, result, 24);
    expect(decision).toMatchObject({ action: 'grade', status: 'miss', hit: false });
  });

  it('grades a real Under hit correctly', () => {
    const pick = { ...basePick, direction: 'Under' };
    const result = { found: true, value: 100, gameStatus: 'final' };
    const decision = determineHalftimeGradeAction(pick, result, 24);
    expect(decision).toMatchObject({ action: 'grade', status: 'hit', hit: true });
  });

  it('skips before the 4-hour gate', () => {
    const result = { found: true, value: 300, gameStatus: 'final' };
    expect(determineHalftimeGradeAction(basePick, result, 2).action).toBe('skip');
  });

  it('skips when the game is not yet final', () => {
    const result = { found: true, value: 300, gameStatus: 'in_progress' };
    expect(determineHalftimeGradeAction(basePick, result, 24).action).toBe('skip');
  });

  it('skips (not voids) a not-found stat on a still-recent game', () => {
    const result = { found: false, value: null, gameStatus: 'in_progress' };
    expect(determineHalftimeGradeAction(basePick, result, 24).action).toBe('skip');
  });

  it('voids a not-found stat once the game is final and 12h have passed', () => {
    const result = { found: false, value: null, gameStatus: 'final' };
    expect(determineHalftimeGradeAction(basePick, result, 13).action).toBe('void');
  });

  it('REGRESSION: voids an unresolvable pick after 7 days even if gameStatus never resolves to final', () => {
    const result = { found: false, value: null, gameStatus: 'not_found' };
    const decision = determineHalftimeGradeAction(basePick, result, 24 * 8);
    expect(decision.action).toBe('void');
    expect(decision.grade_note).toMatch(/7 days/i);
  });

  it('does not void an unresolvable pick before 7 days if gameStatus never resolves', () => {
    const result = { found: false, value: null, gameStatus: 'not_found' };
    expect(determineHalftimeGradeAction(basePick, result, 24 * 3).action).toBe('skip');
  });

  it('voids a likely-DNP pick (0 actual vs a real high projection)', () => {
    const pick = { ...basePick, projection: { blended: 250 } };
    const result = { found: true, value: 0, gameStatus: 'final' };
    const decision = determineHalftimeGradeAction(pick, result, 24);
    expect(decision.action).toBe('void');
    expect(decision.grade_note).toMatch(/dnp/i);
  });

  it('uses the lower MLB DNP threshold', () => {
    const pick = { direction: 'Over', sport: 'mlb', league: 'mlb', projection: { blended: 1.2 } };
    const result = { found: true, value: 0, gameStatus: 'final' };
    expect(determineHalftimeGradeAction(pick, result, 24).action).toBe('void');
  });
});

describe('determineMoneylineGradeAction', () => {
  const pick = { teamAbbrev: 'BOS' };

  function makeSummary({ completed = true, name = 'STATUS_FINAL', homeScore = 4, awayScore = 3, homeAbbrev = 'BOS', awayAbbrev = 'CHC' } = {}) {
    return {
      header: {
        competitions: [{
          status: { type: { completed, name } },
          competitors: [
            { homeAway: 'home', score: String(homeScore), team: { abbreviation: homeAbbrev } },
            { homeAway: 'away', score: String(awayScore), team: { abbreviation: awayAbbrev } },
          ],
        }],
      },
    };
  }

  it('skips when there is no summary', () => {
    expect(determineMoneylineGradeAction(pick, null).action).toBe('skip');
  });

  it('skips when the game is not yet completed', () => {
    expect(determineMoneylineGradeAction(pick, makeSummary({ completed: false })).action).toBe('skip');
  });

  it('voids a postponed game', () => {
    const decision = determineMoneylineGradeAction(pick, makeSummary({ name: 'STATUS_POSTPONED' }));
    expect(decision.action).toBe('void');
  });

  it('voids an unresolvable tie', () => {
    const decision = determineMoneylineGradeAction(pick, makeSummary({ homeScore: 3, awayScore: 3 }));
    expect(decision.action).toBe('void');
  });

  it('grades a hit when the picked team (home) wins', () => {
    const decision = determineMoneylineGradeAction(pick, makeSummary({ homeScore: 4, awayScore: 3 }));
    expect(decision).toMatchObject({ action: 'grade', status: 'hit', hit: true, actual_winner: 'BOS' });
  });

  it('grades a miss when the picked team loses', () => {
    const decision = determineMoneylineGradeAction(pick, makeSummary({ homeScore: 2, awayScore: 5 }));
    expect(decision).toMatchObject({ action: 'grade', status: 'miss', hit: false, actual_winner: 'CHC' });
  });
});

describe('resolvePlayerProjection', () => {
  it('REGRESSION: unwraps NFL\'s nested per-stat projection shape', () => {
    const projections = {
      'Drake Maye': { passingYards: { blended: 245, conservative: 220 } },
    };
    const result = resolvePlayerProjection(projections, 'Drake Maye', 'Passing Yards');
    expect(result).toEqual({ blended: 245, conservative: 220 });
  });

  it('passes through NBA/MLB/NHL\'s already-flat shape unchanged', () => {
    const projections = {
      'Tyrese Haliburton': { conservative: 20, blended: 24, aggressive: 28 },
    };
    const result = resolvePlayerProjection(projections, 'Tyrese Haliburton', 'Points');
    expect(result).toEqual({ conservative: 20, blended: 24, aggressive: 28 });
  });

  it('returns null for a player with no projection at all', () => {
    expect(resolvePlayerProjection({}, 'Nobody', 'Points')).toBeNull();
  });

  it('leaves a nested object unresolved (not crashed) when the stat label has no known mapping', () => {
    const projections = { 'Some Player': { passingYards: { blended: 245 } } };
    const result = resolvePlayerProjection(projections, 'Some Player', 'Some Unmapped Stat');
    expect(result).toEqual({ passingYards: { blended: 245 } });
  });
});

describe('computeHoursSinceGame', () => {
  // The underlying setHours() is local-timezone-sensitive (not UTC), so
  // these assertions stay relative/wide rather than pinning exact hour
  // counts, which would be flaky depending on which timezone the test runs
  // in. (That timezone sensitivity is a real, pre-existing property of the
  // production code, not something these tests paper over.)
  it('returns a larger value for an older game date', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    const recentHours = computeHoursSinceGame('2026-09-24', now);
    const olderHours = computeHoursSinceGame('2026-09-10', now);
    expect(olderHours).toBeGreaterThan(recentHours);
  });

  it('has not yet passed a full day for a game dated today', () => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    expect(computeHoursSinceGame(todayStr, now)).toBeLessThan(24);
  });
});
