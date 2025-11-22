// FILE LOCATION: api/picks/fetch-all.js

import { scoreAllPicks } from '../utils/consensus-scorer.js';
import { writePicks, checkPickExists } from '../utils/firebase-admin.js';

async function fetchFromAllSources() {
  const allPicks = [];

  try {
    console.log('[Fetch-All] Starting source fetch...');
    
    const baseUrl = process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000';
    
    // Fetch from Odds Shark
    try {
      console.log('[Fetch-All] Fetching from Odds Shark RSS...');
      const oddsSharkUrl = `${baseUrl}/api/sources/odds-shark-rss`;
      const response = await fetch(oddsSharkUrl);
      const result = await response.json();

      if (result.success && result.picks) {
        console.log(`[Fetch-All] Odds Shark returned ${result.picks.length} picks`);
        allPicks.push(...result.picks);
      } else {
        console.warn('[Fetch-All] Odds Shark fetch failed:', result.error);
      }
    } catch (error) {
      console.error('[Fetch-All] Error fetching from Odds Shark:', error);
    }
    
    // Fetch from Fox Sports
    try {
      console.log('[Fetch-All] Fetching from Fox Sports RSS...');
      const foxSportsUrl = `${baseUrl}/api/sources/fox-sports-rss`;
      const response = await fetch(foxSportsUrl);
      const result = await response.json();

      if (result.success && result.picks) {
        console.log(`[Fetch-All] Fox Sports returned ${result.picks.length} picks`);
        allPicks.push(...result.picks);
      } else {
        console.warn('[Fetch-All] Fox Sports fetch failed:', result.error);
      }
    } catch (error) {
      console.error('[Fetch-All] Error fetching from Fox Sports:', error);
    }
  } catch (error) {
    console.error('[Fetch-All] Error fetching from sources:', error);
  }

  return allPicks;
}

function filterPicks(picks) {
  return picks.filter(pick => {
    if (pick.confidence < 0.5) return false;
    if (pick.pick.length < 3) return false;
    return true;
  });
}

async function deduplicatePicks(scoredPicks) {
  const unique = [];

  for (const pick of scoredPicks) {
    const exists = await checkPickExists(pick.id);
    
    if (!exists) {
      unique.push(pick);
    }
  }

  console.log(`[Fetch-All] Deduplicated ${scoredPicks.length} to ${unique.length} picks`);
  return unique;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[Fetch-All] Starting pipeline...');
    const startTime = Date.now();

    const rawPicks = await fetchFromAllSources();
    console.log(`[Fetch-All] Total raw picks: ${rawPicks.length}`);

    const filtered = filterPicks(rawPicks);
    console.log(`[Fetch-All] After filtering: ${filtered.length} picks`);

    const scoredPicks = scoreAllPicks(filtered);
    console.log(`[Fetch-All] After scoring: ${scoredPicks.length} consensus picks`);

    const uniquePicks = await deduplicatePicks(scoredPicks);

    if (uniquePicks.length > 0) {
      const written = await writePicks(uniquePicks);
      console.log(`[Fetch-All] Wrote ${written} picks to Firestore`);
    } else {
      console.log('[Fetch-All] No new picks to write');
    }

    const duration = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        rawPicksFound: rawPicks.length,
        afterFiltering: filtered.length,
        afterScoring: scoredPicks.length,
        newPicksAdded: uniquePicks.length,
        durationMs: duration,
      },
      topPicks: uniquePicks.slice(0, 5),
    });
  } catch (error) {
    console.error('[Fetch-All] Pipeline error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
```

---

**Update your repo:**

1. Create `api/sources/odds-shark-rss.js`
2. Create `api/sources/fox-sports-rss.js`
3. Replace `api/picks/fetch-all.js` with the updated version
4. Delete or keep `api/sources/reddit-picks.js` (no longer used)
5. Commit and push

Your next cron job at 6 PM will use these new RSS scrapers. Test manually at:
```
https://your-vercel-url.com/api/picks/fetch-all
