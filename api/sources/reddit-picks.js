// FILE LOCATION: api/sources/reddit-picks.js

const SUBREDDITS = ['sportsbooks', 'nba', 'nfl', 'hockey', 'sportsbetting'];
const PICK_CONFIDENCE = 0.75;

const PICK_KEYWORDS = [
  'pick', 'picks', 'lean', 'liking', 'bet', 'bets', 'play', 'plays', 'lock',
  'over', 'under', 'spread', 'moneyline', 'parlay', 'props', 'prop', 'line',
  'fade', 'follow', 'riding', 'taking'
];

function extractPicksFromPost(post) {
  const picks = [];
  const text = `${post.title} ${post.selftext}`.toLowerCase();
  
  const hasPickKeyword = PICK_KEYWORDS.some(keyword => text.includes(keyword));
  if (!hasPickKeyword) return picks;

  const fullText = `${post.title} ${post.selftext}`;
  
  const teamMatches = fullText.matchAll(/(\w+(?:\s+\w+)?)\s+([-+])(\d+(?:\.\d+)?)/g);
  for (const match of teamMatches) {
    const team = match[1];
    const operator = match[2];
    const line = parseFloat(match[3]);
    
    picks.push({
      pick: `${team} ${operator}${line}`,
      confidence: calculateConfidence(post, text, team),
      keyword: 'team_spread'
    });
  }

  const ouMatches = fullText.matchAll(/(Over|Under)\s+(\d+(?:\.\d+)?)/gi);
  for (const match of ouMatches) {
    const type = match[1].toLowerCase();
    const line = parseFloat(match[2]);
    
    picks.push({
      pick: `${type} ${line}`,
      confidence: calculateConfidence(post, text, type),
      keyword: 'total'
    });
  }

  return picks;
}

function calculateConfidence(post, text, pickKeyword) {
  let confidence = PICK_CONFIDENCE;

  if (post.score > 50) confidence += 0.05;
  if (post.score > 100) confidence += 0.05;
  if (post.score > 200) confidence += 0.05;

  if (post.num_comments > 20) confidence += 0.05;
  if (post.num_comments > 50) confidence += 0.05;

  if (post.title.toLowerCase().includes(pickKeyword.toLowerCase())) {
    confidence += 0.05;
  }

  if (text.includes('or') || text.includes('fade') || text.includes('loss')) {
    confidence -= 0.05;
  }

  return Math.min(confidence, 1.0);
}

async function fetchRedditSubreddit(subreddit) {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ConsensusPicksMVP/1.0 (Sports Betting Analytics)',
      },
    });

    if (!response.ok) {
      console.error(`Reddit fetch failed for r/${subreddit}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const posts = data.data.children;

    const allPicks = [];

    for (const child of posts) {
      const post = child.data;
      
      if (post.stickied || !post.title) continue;

      const picks = extractPicksFromPost(post);

      for (const pick of picks) {
        allPicks.push({
          pick: pick.pick,
          source: `reddit_${subreddit}`,
          subreddit,
          confidence: pick.confidence,
          postTitle: post.title,
          postScore: post.score,
          postComments: post.num_comments,
          postUrl: `https://reddit.com${post.permalink}`,
          postedAt: post.created_utc,
          keyword: pick.keyword,
        });
      }
    }

    return allPicks;
  } catch (error) {
    console.error(`Error fetching Reddit r/${subreddit}:`, error.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Starting Reddit picks fetch...');
    
    const allPicks = [];

    for (const subreddit of SUBREDDITS) {
      console.log(`Fetching from r/${subreddit}...`);
      const picks = await fetchRedditSubreddit(subreddit);
      allPicks.push(...picks);
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`Total picks extracted: ${allPicks.length}`);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      totalPicksFound: allPicks.length,
      picks: allPicks,
    });
  } catch (error) {
    console.error('Error in reddit-picks handler:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
