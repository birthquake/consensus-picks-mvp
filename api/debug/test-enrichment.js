// FILE LOCATION: api/debug/test-enrichment.js
// Temporary debug endpoint — remove before production.
// Hit this to see exactly what espn-enrichment returns for a player.
//
// Usage:
//   GET /api/debug/test-enrichment?player=Shai+Gilgeous-Alexander&stat=Points&sport=NBA&date=2026-03-21
//   GET /api/debug/test-enrichment?player=Connor+McDavid&stat=Goals&sport=NHL&date=2026-03-21
//   GET /api/debug/test-enrichment?player=Aaron+Judge&stat=Home+Runs&sport=MLB&date=2026-04-05

import { enrichPicks, formatEnrichmentForPrompt } from '../utils/espn-enrichment.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { player, stat, sport, date, line } = req.query;

  if (!player || !stat || !sport) {
    return res.status(400).json({
      error: 'Missing params',
      usage: '/api/debug/test-enrichment?player=Shai+Gilgeous-Alexander&stat=Points&sport=NBA&date=2026-03-21&line=28.5'
    });
  }

  const gameDate = date || new Date().toISOString().split('T')[0];

  const mockPick = {
    player,
    stat,
    sport,
    bet_type: 'Over',
    line: line ? parseFloat(line) : null,
  };

  console.log(`[test-enrichment] Testing: ${player} | ${stat} | ${sport} | ${gameDate}`);

  try {
    const start = Date.now();
    const enrichments = await enrichPicks([mockPick], gameDate);
    const elapsed = Date.now() - start;
    const e = enrichments[0];

    // Build a clean diagnostic response
    const diagnostic = {
      input: { player, stat, sport, gameDate, line: mockPick.line },
      elapsed_ms: elapsed,
      result: {
        found: !e.error,
        playerFullName: e.playerFullName || null,
        espnId: e.espnId || null,
        injuryStatus: e.injuryStatus || null,
        statKey: e.statKey || null,
        opponent: e.opponent || null,
        recentForm: e.recentForm || null,
        error: e.error || null,
      },
      prompt_block: formatEnrichmentForPrompt(enrichments),
      raw: e,
    };

    // Flag what's working vs missing
    diagnostic.checks = {
      athlete_found:    !!e.espnId,
      injury_found:     !!e.injuryStatus && e.injuryStatus !== 'Unknown',
      form_found:       !!(e.recentForm?.length > 0),
      form_has_values:  !!(e.recentForm?.some(g => g.value !== null)),
      opponent_found:   !!e.opponent,
      prompt_populated: diagnostic.prompt_block.length > 50,
    };

    const allGood = Object.values(diagnostic.checks).every(Boolean);
    diagnostic.status = allGood ? '✅ All checks passed' : '⚠️ Some data missing — see checks';

    return res.status(200).json(diagnostic);

  } catch (err) {
    console.error('[test-enrichment] Error:', err);
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
