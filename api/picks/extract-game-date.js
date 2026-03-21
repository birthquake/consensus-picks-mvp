// FILE LOCATION: api/picks/extract-game-date.js
// Lightweight endpoint — reads only the game date from a bet slip image.
// Called in the background right after image selection so the date picker
// can be pre-filled before the user hits Submit.
// Fast: single small Claude call, no Firestore, no ESPN.

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, imageMediaType } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: 'Missing imageBase64' });
  }

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageMediaType || 'image/jpeg',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: `Look at this sports bet slip and find the game date — the date the game is scheduled to be played, not when the bet was placed.

Return ONLY a JSON object with one key. No markdown, no extra text.

If you can find a clear game date: {"game_date":"YYYY-MM-DD"}
If no game date is visible: {"game_date":null}`,
          },
        ],
      }],
    });

    const raw = msg.content[0].text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(raw);

    return res.status(200).json({ game_date: parsed.game_date || null });
  } catch (err) {
    console.error('[extract-game-date] error:', err.message);
    return res.status(200).json({ game_date: null });
  }
}
