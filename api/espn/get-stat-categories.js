// FILE LOCATION: api/espn/get-stat-categories.js
export default async function handler(req, res) {
  const { sport } = req.query;

  try {
    const categories = getStatCategories(sport);

    res.status(200).json({
      success: true,
      sport,
      categories
    });
  } catch (error) {
    console.error('Error getting stat categories:', error);
    res.status(500).json({ error: error.message });
  }
}

function getStatCategories(sport) {
  const categoryMap = {
    NFL: [
      { id: 'passing_yards', name: 'Passing Yards', playerType: 'QB' },
      { id: 'receiving_yards', name: 'Receiving Yards', playerType: 'WR/TE' },
      { id: 'rushing_yards', name: 'Rushing Yards', playerType: 'RB' },
      { id: 'receptions', name: 'Receptions', playerType: 'WR/TE' },
      { id: 'touchdowns', name: 'Touchdowns', playerType: 'All' }
    ],
    NBA: [
      { id: 'points', name: 'Points', playerType: 'All' },
      { id: 'rebounds', name: 'Rebounds', playerType: 'All' },
      { id: 'assists', name: 'Assists', playerType: 'All' },
      { id: 'three_pointers', name: '3-Pointers', playerType: 'All' }
    ],
    NHL: [
      { id: 'shots_on_goal', name: 'Shots on Goal', playerType: 'All' },
      { id: 'goals', name: 'Goals', playerType: 'All' },
      { id: 'assists', name: 'Assists', playerType: 'All' },
      { id: 'hits', name: 'Hits', playerType: 'All' }
    ],
    CollegeBasketball: [
      { id: 'points', name: 'Points', playerType: 'All' },
      { id: 'rebounds', name: 'Rebounds', playerType: 'All' },
      { id: 'assists', name: 'Assists', playerType: 'All' }
    ]
  };

  return categoryMap[sport] || [];
}
