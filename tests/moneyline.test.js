// FILE LOCATION: tests/moneyline.test.js
// Tests for the pure odds-math and rating logic in api/moneyline.js —
// imports the module itself, which initializes firebase-admin at load time
// (see tests/setup.js for the fake-credential workaround that makes that
// safe to do in a test process without ever touching real Firestore).

import { describe, it, expect } from 'vitest';
import {
  americanToImplied,
  devig,
  americanToDecimal,
  expectedValuePct,
  computeRating,
  isRanked,
  checkKeyInjury,
} from '../api/moneyline.js';

describe('americanToImplied', () => {
  it('converts a favorite (negative odds)', () => {
    expect(americanToImplied(-200)).toBeCloseTo(0.6667, 3);
  });

  it('converts an underdog (positive odds)', () => {
    expect(americanToImplied(150)).toBeCloseTo(0.4, 3);
  });

  it('returns null for missing odds', () => {
    expect(americanToImplied(null)).toBeNull();
  });
});

describe('devig', () => {
  it('normalizes two implied probabilities to sum to 1', () => {
    const { home, away } = devig(0.55, 0.52); // sums to 1.07 (the vig)
    expect(home + away).toBeCloseTo(1, 5);
  });

  it('returns nulls when an input is missing', () => {
    expect(devig(null, 0.5)).toEqual({ home: null, away: null });
  });
});

describe('americanToDecimal / expectedValuePct', () => {
  it('computes decimal odds for a plus-money underdog', () => {
    expect(americanToDecimal(275)).toBeCloseTo(3.75, 5);
  });

  it('computes decimal odds for a favorite', () => {
    expect(americanToDecimal(-192)).toBeCloseTo(1.5208, 3);
  });

  it('computes positive EV when the model\'s win probability beats the implied breakeven', () => {
    // +275 implies ~26.7% breakeven; a 37.1% model probability should be +EV
    const ev = expectedValuePct(37.1, 275);
    expect(ev).toBeGreaterThan(0);
  });

  it('computes negative EV when the model agrees with a bad price', () => {
    const ev = expectedValuePct(20, 275); // way below breakeven
    expect(ev).toBeLessThan(0);
  });
});

describe('computeRating', () => {
  it('rates the MIN_EDGE_PP floor band as 3 stars', () => {
    expect(computeRating(7, 10, 3, false)).toBe(3);
  });

  it('rates the sweet-spot band (9-14pp) as 5 stars', () => {
    expect(computeRating(10, 10, 3, false)).toBe(5);
  });

  it('rates above the sweet spot (14-20pp) as 4 stars', () => {
    expect(computeRating(15, 10, 3, false)).toBe(4);
  });

  it('REGRESSION: walks an outlier edge (20pp+) back down instead of maxing it out', () => {
    expect(computeRating(25, 10, 3, false)).toBe(3);
  });

  it('docks a star for thin current-season data', () => {
    expect(computeRating(10, 2, 3, false)).toBe(4);
  });

  it('docks a star when the line has moved against the pick', () => {
    expect(computeRating(10, 10, 3, true)).toBe(4);
  });

  it('docks a star when the picked team is missing its starting QB', () => {
    expect(computeRating(10, 10, 3, false, { player: 'Someone', status: 'Out' })).toBe(4);
  });

  it('clamps to a minimum of 1 star when penalties stack', () => {
    expect(computeRating(25, 2, 3, true)).toBe(1);
  });
});

describe('checkKeyInjury', () => {
  function summaryWith(teamAbbrev, injuries) {
    return { injuries: [{ team: { abbreviation: teamAbbrev }, injuries }] };
  }

  it('flags an Out QB for the picked team', () => {
    const summary = summaryWith('KC', [{ status: 'Out', athlete: { fullName: 'Pat Mahomes', position: { abbreviation: 'QB' } } }]);
    const result = checkKeyInjury(summary, 'KC', 'football');
    expect(result).toMatchObject({ player: 'Pat Mahomes', status: 'Out' });
  });

  it('flags a Doubtful QB too', () => {
    const summary = summaryWith('KC', [{ status: 'Doubtful', athlete: { fullName: 'Someone', position: { abbreviation: 'QB' } } }]);
    expect(checkKeyInjury(summary, 'KC', 'football')).not.toBeNull();
  });

  it('ignores non-QB injuries', () => {
    const summary = summaryWith('KC', [{ status: 'Out', athlete: { fullName: 'A Lineman', position: { abbreviation: 'OT' } } }]);
    expect(checkKeyInjury(summary, 'KC', 'football')).toBeNull();
  });

  it('ignores a merely Questionable QB', () => {
    const summary = summaryWith('KC', [{ status: 'Questionable', athlete: { fullName: 'Pat Mahomes', position: { abbreviation: 'QB' } } }]);
    expect(checkKeyInjury(summary, 'KC', 'football')).toBeNull();
  });

  it('does not apply to sports with no defined key position (e.g. basketball)', () => {
    const summary = summaryWith('LAL', [{ status: 'Out', athlete: { fullName: 'Star Player', position: { abbreviation: 'PG' } } }]);
    expect(checkKeyInjury(summary, 'LAL', 'basketball')).toBeNull();
  });

  it('returns null when the team has no injury entry at all', () => {
    expect(checkKeyInjury({ injuries: [] }, 'KC', 'football')).toBeNull();
  });
});

describe('isRanked', () => {
  it('treats 1-25 as ranked', () => {
    expect(isRanked(1)).toBe(true);
    expect(isRanked(25)).toBe(true);
  });

  it('treats ESPN\'s unranked sentinel (99) as not ranked', () => {
    expect(isRanked(99)).toBe(false);
  });

  it('treats non-numeric/null as not ranked', () => {
    expect(isRanked(null)).toBe(false);
    expect(isRanked(undefined)).toBe(false);
  });
});
