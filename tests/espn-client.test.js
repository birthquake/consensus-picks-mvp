// FILE LOCATION: tests/espn-client.test.js
// Regression tests for the two lib/espn-client.js bugs fixed 2026-10-04:
// (1) extractPlayerStat only ever checked the first statistics block per
//     team, so non-passing NFL stats could never be found;
// (2) similarityScore scored an empty/missing shortName as a 0.9 match via
//     `a.includes('')` being trivially true, causing the first athlete in a
//     block to falsely "match" any search name.

import { describe, it, expect } from 'vitest';
import { similarityScore, findBestPlayerMatch, extractPlayerStat, getGameStatus } from '../lib/espn-client.js';

describe('similarityScore', () => {
  it('REGRESSION: never scores an empty/missing name as a match', () => {
    expect(similarityScore('ashton jeanty', '')).toBe(0);
    expect(similarityScore('', 'chuba hubbard')).toBe(0);
    expect(similarityScore('', '')).toBe(0);
  });

  it('scores an exact match as 1', () => {
    expect(similarityScore('patrick mahomes', 'patrick mahomes')).toBe(1);
  });

  it('scores a substring match highly', () => {
    expect(similarityScore('mahomes', 'patrick mahomes')).toBe(0.9);
  });

  it('scores unrelated names low', () => {
    expect(similarityScore('ashton jeanty', 'chuba hubbard')).toBeLessThan(0.6);
  });
});

describe('findBestPlayerMatch', () => {
  it('REGRESSION: does not match the first athlete when names have no real shortName field', () => {
    const athletes = [
      { athlete: { displayName: 'Chuba Hubbard' } }, // shortName absent, like real ESPN data
      { athlete: { displayName: 'Ashton Jeanty' } },
    ];
    const match = findBestPlayerMatch(athletes, 'Ashton Jeanty');
    expect(match.athlete.displayName).toBe('Ashton Jeanty');
  });

  it('returns null when no athlete is a real match', () => {
    const athletes = [{ athlete: { displayName: 'Someone Else' } }];
    expect(findBestPlayerMatch(athletes, 'Ashton Jeanty')).toBeNull();
  });

  it('matches on last name alone', () => {
    const athletes = [{ athlete: { displayName: 'Patrick Mahomes' } }];
    expect(findBestPlayerMatch(athletes, 'Mahomes')).not.toBeNull();
  });
});

describe('extractPlayerStat', () => {
  // Shape mirrors a real NFL boxscore: one entry per team, each carrying
  // multiple statistics blocks (passing, rushing, receiving, ...).
  function nflSummary() {
    return {
      boxscore: {
        players: [
          {
            team: { displayName: 'Las Vegas Raiders' },
            statistics: [
              { name: 'passing', keys: ['passingYards'], athletes: [{ athlete: { displayName: 'Geno Smith' } }, { athlete: { displayName: 'Ashton Jeanty' } }].map((a, i) => ({ ...a, stats: [String(200 + i)] })) },
              { name: 'rushing', keys: ['rushingYards'], athletes: [{ athlete: { displayName: 'Ashton Jeanty' }, stats: ['48'] }] },
            ],
          },
        ],
      },
    };
  }

  it('REGRESSION: finds a stat in a non-first statistics block (e.g. rushing, not passing)', () => {
    const result = extractPlayerStat(nflSummary(), 'Ashton Jeanty', 'Rushing Yards');
    expect(result.found).toBe(true);
    expect(result.value).toBe(48);
    expect(result.playerFullName).toBe('Ashton Jeanty');
  });

  it('still finds a stat in the first block (no regression on the normal case)', () => {
    const result = extractPlayerStat(nflSummary(), 'Geno Smith', 'Passing Yards');
    expect(result.found).toBe(true);
  });

  it('returns found:false when the player genuinely is not in any block', () => {
    const result = extractPlayerStat(nflSummary(), 'Nobody Real', 'Rushing Yards');
    expect(result.found).toBe(false);
  });

  it('returns found:false with no boxscore data', () => {
    const result = extractPlayerStat({}, 'Anyone', 'Points');
    expect(result.found).toBe(false);
  });
});

describe('getGameStatus', () => {
  it('reports final for a completed game', () => {
    const summary = { header: { competitions: [{ status: { type: { completed: true } } }] } };
    expect(getGameStatus(summary)).toBe('final');
  });

  it('reports in_progress for a live game', () => {
    const summary = { header: { competitions: [{ status: { type: { completed: false, state: 'in' } } }] } };
    expect(getGameStatus(summary)).toBe('in_progress');
  });

  it('reports pre_game for a scheduled game', () => {
    const summary = { header: { competitions: [{ status: { type: { completed: false, state: 'pre' } } }] } };
    expect(getGameStatus(summary)).toBe('pre_game');
  });
});
