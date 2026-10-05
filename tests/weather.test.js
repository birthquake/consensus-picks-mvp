// FILE LOCATION: tests/weather.test.js

import { describe, it, expect } from 'vitest';
import { getNotableFootballWeather, NFL_STADIUMS } from '../lib/weather.js';

describe('getNotableFootballWeather', () => {
  it('flags severe conditions', () => {
    const note = getNotableFootballWeather({ indoor: false, windSpeed: 25, windGusts: 35, precipPct: 80, temp: 20 });
    expect(note).toMatch(/wind/);
    expect(note).toMatch(/gusts/);
    expect(note).toMatch(/precipitation/);
    expect(note).toMatch(/°F/);
  });

  it('returns null for mild conditions', () => {
    expect(getNotableFootballWeather({ indoor: false, windSpeed: 8, windGusts: 12, precipPct: 10, temp: 65 })).toBeNull();
  });

  it('returns null for indoor stadiums regardless of conditions', () => {
    expect(getNotableFootballWeather({ indoor: true, windSpeed: 40 })).toBeNull();
  });

  it('returns null with no weather data', () => {
    expect(getNotableFootballWeather(null)).toBeNull();
  });
});

describe('NFL_STADIUMS', () => {
  it('has all 32 teams', () => {
    expect(Object.keys(NFL_STADIUMS).length).toBe(32);
  });

  it('correctly marks known domes as indoor', () => {
    expect(NFL_STADIUMS.NO.indoor).toBe(true);
    expect(NFL_STADIUMS.ATL.indoor).toBe(true);
    expect(NFL_STADIUMS.DAL.indoor).toBe(true);
  });

  it('correctly marks known open-air stadiums as outdoor', () => {
    expect(NFL_STADIUMS.GB.indoor).toBe(false);
    expect(NFL_STADIUMS.CHI.indoor).toBe(false);
    expect(NFL_STADIUMS.BUF.indoor).toBe(false);
  });
});
