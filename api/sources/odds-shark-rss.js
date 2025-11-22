// FILE LOCATION: api/sources/odds-shark-rss.js

const OddsSharkURL = 'https://www.oddsshark.com/rss.xml';

async function parseOddsSharkFeed() {
  try {
    const response = await fetch(OddsSharkURL);
    const text = await response.text();
    
    // Simple XML parsing for odds data
    const picks = [];
    
    // Extract items from RSS
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemRegex.exec(text)) !== null) {
      const itemContent = match[1];
      
      // Extract title
      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';
      
      // Extract description/content
      const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/);
      const description = descMatch ? descMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';
      
      // Extract link
      const linkMatch = itemContent.match(/<link>(.*?)<\/link>/);
      const link = linkMatch ? linkMatch[1] : '';
      
      // Try to extract picks from title and description
      const fullText = `${title} ${description}`.toLowerCase();
      
      // Look for common pick patterns
      const pickPatterns = [
        /(\w+)\s+[-+](\d+(?:\.\d+)?)/g,  // Team -5.5
        /(over|under)\s+(\d+(?:\.\d+)?)/gi, // Over/Under
      ];
      
      const extractedPicks = [];
      
      for (const pattern of pickPatterns) {
        let pickMatch;
        while ((pickMatch = pattern.exec(fullText)) !== null) {
          extractedPicks.push({
            pick: `${pickMatch[1]} ${pickMatch[2]}`,
            confidence: 0.8, // Odds Shark is professional source
            keyword: 'odds_shark'
          });
        }
      }
      
      // If we found picks, add them
      if (extractedPicks.length > 0) {
        for (const pick of extractedPicks) {
          picks.push({
            pick: pick.pick,
            source: 'odds_shark_rss',
            confidence: pick.confidence,
            postTitle: title,
            postUrl: link,
            postedAt: Math.floor(Date.now() / 1000),
            keyword: pick.keyword,
          });
        }
      }
    }
    
    return picks;
  } catch (error) {
    console.error('Error parsing Odds Shark RSS:', error.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Starting Odds Shark RSS fetch...');
    const picks = await parseOddsSharkFeed();
    
    console.log(`Total picks extracted from Odds Shark: ${picks.length}`);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      totalPicksFound: picks.length,
      picks: picks,
    });
  } catch (error) {
    console.error('Error in odds-shark-rss handler:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
