// FILE LOCATION: api/sources/fox-sports-rss.js

const SPORTS = [
  { tag: 'fs/nfl', sport: 'nfl' },
  { tag: 'fs/nba', sport: 'nba' },
  { tag: 'fs/nhl', sport: 'nhl' }
];

const PARTNER_KEY = 'MB0Wehpmuj2lUhuRhQaafhBjAJqaPU244mlTDK1i';

async function fetchFoxSportsFeed(tag) {
  try {
    const url = `https://api.foxsports.com/v2/content/optimized-rss?partnerKey=${PARTNER_KEY}&size=30&tags=${tag}`;
    
    const response = await fetch(url);
    const text = await response.text();
    
    const picks = [];
    
    // Extract items from RSS
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemRegex.exec(text)) !== null) {
      const itemContent = match[1];
      
      // Extract title
      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';
      
      // Extract description
      const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/);
      const description = descMatch ? descMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';
      
      // Extract link
      const linkMatch = itemContent.match(/<link>(.*?)<\/link>/);
      const link = linkMatch ? linkMatch[1] : '';
      
      // Only process if it looks like picks/bets/odds content
      const fullText = `${title} ${description}`.toLowerCase();
      const isPickContent = fullText.includes('best bet') || 
                           fullText.includes('pick') || 
                           fullText.includes('odds') || 
                           fullText.includes('parlay') ||
                           fullText.includes('prediction');
      
      if (!isPickContent) continue;
      
      // Extract picks from title and description
      const pickPatterns = [
        /(\w+(?:\s+\w+)?)\s+([-+])(\d+(?:\.\d+)?)/g,  // Team -5.5
        /(over|under)\s+(\d+(?:\.\d+)?)/gi,            // Over/Under
      ];
      
      const fullContentText = `${title} ${description}`;
      
      for (const pattern of pickPatterns) {
        let pickMatch;
        while ((pickMatch = pattern.exec(fullContentText)) !== null) {
          picks.push({
            pick: `${pickMatch[1]} ${pickMatch[2]}${pickMatch[3] || ''}`,
            source: `fox_sports_${tag.replace('/', '_')}`,
            confidence: 0.85, // Fox Sports is professional source
            postTitle: title,
            postUrl: link,
            postedAt: Math.floor(Date.now() / 1000),
            keyword: 'fox_sports'
          });
        }
      }
    }
    
    return picks;
  } catch (error) {
    console.error(`Error parsing Fox Sports RSS for ${tag}:`, error.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Starting Fox Sports RSS fetch...');
    
    const allPicks = [];
    
    for (const sport of SPORTS) {
      console.log(`Fetching Fox Sports RSS for ${sport.sport}...`);
      const picks = await fetchFoxSportsFeed(sport.tag);
      allPicks.push(...picks);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`Total picks extracted from Fox Sports: ${allPicks.length}`);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      totalPicksFound: allPicks.length,
      picks: allPicks,
    });
  } catch (error) {
    console.error('Error in fox-sports-rss handler:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
