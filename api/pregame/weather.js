// FILE LOCATION: api/pregame/weather.js
// Fetches game-time weather from Open-Meteo API (free, no key required).
//
// Weather factors that affect MLB scoring:
//   - Wind speed + direction : blowing out = HR/TB boost; blowing in = suppressor
//   - Temperature            : cold air = dead ball; hot air = livelier ball
//   - Precipitation          : rain = slower game, slippery grip, pitcher advantage
//
// Only applies to OUTDOOR stadiums — retractable/fixed roof stadiums are excluded.
// Returns null for indoor/dome stadiums (no weather adjustment needed).

const STADIUMS = {
  // AL East
  BAL: { name: 'Camden Yards',            lat: 39.2838, lon: -76.6216,   indoor: false },
  BOS: { name: 'Fenway Park',              lat: 42.3467, lon: -71.0972,   indoor: false },
  NYY: { name: 'Yankee Stadium',           lat: 40.8296, lon: -73.9262,   indoor: false },
  TB:  { name: 'Tropicana Field',          lat: 27.7683, lon: -82.6534,   indoor: true  },
  TOR: { name: 'Rogers Centre',            lat: 43.6414, lon: -79.3894,   indoor: true  },
  // AL Central
  CWS: { name: 'Guaranteed Rate Field',    lat: 41.8300, lon: -87.6339,   indoor: false },
  CHW: { name: 'Guaranteed Rate Field',    lat: 41.8300, lon: -87.6339,   indoor: false },
  CLE: { name: 'Progressive Field',        lat: 41.4962, lon: -81.6852,   indoor: false },
  DET: { name: 'Comerica Park',            lat: 42.3390, lon: -83.0485,   indoor: false },
  KC:  { name: 'Kauffman Stadium',         lat: 39.0517, lon: -94.4803,   indoor: false },
  MIN: { name: 'Target Field',             lat: 44.9817, lon: -93.2781,   indoor: false },
  // AL West
  HOU: { name: 'Minute Maid Park',         lat: 29.7573, lon: -95.3555,   indoor: true  },
  LAA: { name: 'Angel Stadium',            lat: 33.8003, lon: -117.8827,  indoor: false },
  OAK: { name: 'Oakland Coliseum',         lat: 37.7516, lon: -122.2005,  indoor: false },
  ATH: { name: 'Oakland Coliseum',         lat: 37.7516, lon: -122.2005,  indoor: false },
  SEA: { name: 'T-Mobile Park',            lat: 47.5914, lon: -122.3325,  indoor: true  },
  TEX: { name: 'Globe Life Field',         lat: 32.7512, lon: -97.0832,   indoor: true  },
  // NL East
  ATL: { name: 'Truist Park',              lat: 33.8908, lon: -84.4678,   indoor: false },
  MIA: { name: 'loanDepot park',           lat: 25.7781, lon: -80.2197,   indoor: true  },
  NYM: { name: 'Citi Field',              lat: 40.7571, lon: -73.8458,   indoor: false },
  PHI: { name: 'Citizens Bank Park',       lat: 39.9061, lon: -75.1665,   indoor: false },
  WSH: { name: 'Nationals Park',           lat: 38.8730, lon: -77.0074,   indoor: false },
  // NL Central
  CHC: { name: 'Wrigley Field',            lat: 41.9484, lon: -87.6553,   indoor: false },
  CIN: { name: 'Great American Ball Park', lat: 39.0975, lon: -84.5082,   indoor: false },
  MIL: { name: 'American Family Field',    lat: 43.0280, lon: -87.9712,   indoor: true  },
  PIT: { name: 'PNC Park',                 lat: 40.4469, lon: -80.0057,   indoor: false },
  STL: { name: 'Busch Stadium',            lat: 38.6226, lon: -90.1928,   indoor: false },
  // NL West
  ARI: { name: 'Chase Field',              lat: 33.4455, lon: -112.0667,  indoor: true  },
  COL: { name: 'Coors Field',              lat: 39.7559, lon: -104.9942,  indoor: false },
  LAD: { name: 'Dodger Stadium',           lat: 34.0739, lon: -118.2400,  indoor: false },
  SD:  { name: 'Petco Park',               lat: 32.7076, lon: -117.1570,  indoor: false },
  SF:  { name: 'Oracle Park',              lat: 37.7786, lon: -122.3893,  indoor: false },
};

function windDirection(degrees) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(degrees / 45) % 8];
}

export async function getGameWeather(homeTeamAbbrev, gameDate) {
  try {
    const stadium = STADIUMS[homeTeamAbbrev?.toUpperCase()];
    if (!stadium) {
      console.log(`[weather] No stadium data for ${homeTeamAbbrev}`);
      return null;
    }

    if (stadium.indoor) {
      console.log(`[weather] ${stadium.name} is indoor/retractable — no weather adjustment`);
      return { indoor: true, stadium: stadium.name };
    }

    const dateStr = gameDate ? gameDate.substring(0, 10) : new Date().toISOString().substring(0, 10);

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${stadium.lat}&longitude=${stadium.lon}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=America%2FNew_York&start_date=${dateStr}&end_date=${dateStr}`;

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res   = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) {
      console.log(`[weather] Open-Meteo returned ${res.status}`);
      return null;
    }

    const data   = await res.json();
    const hourly = data?.hourly;
    if (!hourly) return null;

    // Use 7pm ET as default game time
    const targetHour = 19;
    const hourIndex  = hourly.time?.findIndex(t => new Date(t).getHours() >= targetHour) ?? 19;
    const idx        = hourIndex >= 0 ? hourIndex : 19;

    const temp      = hourly.temperature_2m?.[idx];
    const windSpeed = hourly.wind_speed_10m?.[idx];
    const windDir   = hourly.wind_direction_10m?.[idx];
    const windGusts = hourly.wind_gusts_10m?.[idx];
    const precipPct = hourly.precipitation_probability?.[idx];

    console.log(`[weather] ${stadium.name}: ${Math.round(temp)}°F, wind ${Math.round(windSpeed)}mph ${windDirection(windDir)}, precip ${precipPct}%`);

    return {
      indoor:       false,
      stadium:      stadium.name,
      temp,
      windSpeed,
      windDir,
      windDirLabel: windDirection(windDir),
      windGusts,
      precipPct,
    };
  } catch (err) {
    console.log(`[weather] Error: ${err.message}`);
    return null;
  }
}

export function getWeatherMultiplier(weather) {
  if (!weather || weather.indoor) return 1.0;

  let mult = 1.0;

  if (weather.windSpeed != null) {
    const speed = weather.windSpeed;
    const dir   = weather.windDir ?? 180;

    if (speed >= 15) {
      if (dir >= 135 && dir <= 270)       mult *= speed >= 20 ? 1.08 : 1.05;
      else if (dir <= 45 || dir >= 315)   mult *= speed >= 20 ? 0.92 : 0.95;
    } else if (speed >= 10) {
      if (dir >= 135 && dir <= 270)       mult *= 1.03;
      else if (dir <= 45 || dir >= 315)   mult *= 0.97;
    }
  }

  if (weather.temp != null) {
    const temp = weather.temp;
    if (temp < 45)      mult *= 0.94;
    else if (temp < 55) mult *= 0.97;
    else if (temp > 85) mult *= 1.03;
    else if (temp > 95) mult *= 1.05;
  }

  if (weather.precipPct != null) {
    if (weather.precipPct >= 70)      mult *= 0.93;
    else if (weather.precipPct >= 40) mult *= 0.97;
  }

  return Math.max(0.88, Math.min(1.12, Math.round(mult * 100) / 100));
}

export function formatWeatherForPrompt(weather) {
  if (!weather) return null;
  if (weather.indoor) return `Indoor/retractable roof — no weather factor`;

  const parts = [];
  if (weather.temp != null)      parts.push(`${Math.round(weather.temp)}°F`);
  if (weather.windSpeed != null) parts.push(`wind ${Math.round(weather.windSpeed)}mph ${weather.windDirLabel}`);
  if (weather.precipPct != null && weather.precipPct > 20) parts.push(`${weather.precipPct}% precip chance`);

  const mult = getWeatherMultiplier(weather);
  if (mult !== 1.0) {
    const dir = mult > 1 ? '↑' : '↓';
    parts.push(`Weather adjustment: ${dir}${Math.round(Math.abs(mult - 1) * 100)}%`);
  }

  return parts.length ? parts.join(' | ') : null;
}
