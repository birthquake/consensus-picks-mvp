// FILE LOCATION: api/picks/fetch-all.js

import { scoreAllPicks } from '../utils/consensus-scorer.js';
import { writePicks, checkPickExists } from '../utils/firebase-admin.js';

async function fetchFromAllSources() {
  const allPicks = [];

  try {
    console.log('[Fetch-All] Starting Reddit pick fetch...');
    
    const redditUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/sources/reddit-picks`;
    
    const response = await fetch(redditUrl);
    const result = await response.json();

    if (result.success && result.picks) {
      console.log(`[Fetch-All] Reddit returned ${result.picks.length} picks`);
      allPicks.push(...result.picks);
    } else {
      console.warn('[Fetch-All] Reddit fetch failed:', result.error);
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
