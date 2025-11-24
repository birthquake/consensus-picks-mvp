// FILE LOCATION: api/espn/get-players.js
export default async function handler(req, res) {
  const { gameId, sport, category } = req.query;

  try {
    const players = getMockPlayers(sport, category, gameId);

    res.status(200).json({
      success: true,
      sport,
      gameId,
      category,
      players
    });
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ error: error.message });
  }
}

function getMockPlayers(sport, category, gameId) {
  // This is mock data - in production, you'd fetch from ESPN API
  const playerMap = {
    NFL: {
      passing_yards: [
        { id: '1', name: 'Patrick Mahomes', team: 'KC Chiefs', avg: 265 },
        { id: '2', name: 'Jalen Brunson', team: 'JAX Jaguars', avg: 215 }
      ],
      receiving_yards: [
        { id: '3', name: 'Travis Kelce', team: 'KC Chiefs', avg: 75 },
        { id: '4', name: 'Rashee Rice', team: 'KC Chiefs', avg: 55 }
      ],
      rushing_yards: [
        { id: '5', name: 'Isiah Pacheco', team: 'KC Chiefs', avg: 65 },
        { id: '6', name: 'James Robinson', team: 'JAX Jaguars', avg: 72 }
      ]
    },
    NBA: {
      points: [
        { id: '1', name: 'LeBron James', team: 'LA Lakers', avg: 24 },
        { id: '2', name: 'Stephen Curry', team: 'Golden State Warriors', avg: 28 }
      ],
      rebounds: [
        { id: '3', name: 'Joel Embiid', team: 'Philadelphia 76ers', avg: 11 },
        { id: '4', name: 'Nikola Jokic', team: 'Denver Nuggets', avg: 12 }
      ]
    },
    NHL: {
      shots_on_goal: [
        { id: '1', name: 'Connor McDavid', team: 'Edmonton Oilers', avg: 4 },
        { id: '2', name: 'Auston Matthews', team: 'TOR Maple Leafs', avg: 4 }
      ]
    }
  };

  return playerMap[sport]?.[category] || [];
}
