// FILE LOCATION: src/components/LegForm.jsx
import { useState, useEffect } from 'react';
import '../styles/LegForm.css';

export default function LegForm({ 
  leg, 
  index, 
  sport,
  gameId,
  onUpdate, 
  onRemove, 
  canRemove 
}) {
  const [categories, setCategories] = useState([]);
  const [players, setPlayers] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [playersLoading, setPlayersLoading] = useState(false);

  // Fetch stat categories when sport changes
  useEffect(() => {
    fetchCategories();
  }, [sport]);

  // Fetch players when category or game changes
  useEffect(() => {
    if (leg.statCategory && gameId) {
      fetchPlayers();
    } else {
      setPlayers([]);
    }
  }, [leg.statCategory, gameId]);

  const fetchCategories = async () => {
    setCategoriesLoading(true);
    try {
      const response = await fetch(`/api/espn/get-stat-categories?sport=${sport}`);
      const data = await response.json();
      
      if (data.success) {
        setCategories(data.categories);
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    } finally {
      setCategoriesLoading(false);
    }
  };

  const fetchPlayers = async () => {
    setPlayersLoading(true);
    try {
      const response = await fetch(
        `/api/espn/get-players?sport=${sport}&gameId=${gameId}&category=${leg.statCategory}`
      );
      const data = await response.json();
      
      if (data.success) {
        setPlayers(data.players);
      }
    } catch (err) {
      console.error('Error fetching players:', err);
    } finally {
      setPlayersLoading(false);
    }
  };

  // Suggest thresholds based on player average
  const suggestedThresholds = () => {
    const player = players.find(p => p.name === leg.player);
    if (!player) return [];

    const avg = player.avg;
    return [
      `${Math.floor(avg) - 10}+`,
      `${Math.floor(avg)}+`,
      `${Math.floor(avg) + 10}+`,
      `${Math.floor(avg) + 20}+`
    ];
  };

  return (
    <div className="leg-form">
      <div className="leg-header">
        <h4>Leg {index + 1}</h4>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="remove-leg-btn"
          >
            Remove
          </button>
        )}
      </div>

      <div className="leg-inputs">
        {/* Stat Category Dropdown */}
        <div className="input-group">
          <label>Stat Category:</label>
          {categoriesLoading ? (
            <div className="loading-text">Loading categories...</div>
          ) : (
            <select
              value={leg.statCategory}
              onChange={(e) => {
                onUpdate(index, 'statCategory', e.target.value);
                onUpdate(index, 'player', ''); // Reset player
                onUpdate(index, 'stat', '');
              }}
            >
              <option value="">Select category...</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Player Dropdown */}
        <div className="input-group">
          <label>Player:</label>
          {!leg.statCategory ? (
            <div className="loading-text">Select category first...</div>
          ) : playersLoading ? (
            <div className="loading-text">Loading players...</div>
          ) : (
            <select
              value={leg.player}
              onChange={(e) => onUpdate(index, 'player', e.target.value)}
              disabled={players.length === 0}
            >
              <option value="">Select player...</option>
              {players.map(player => (
                <option key={player.id} value={player.name}>
                  {player.name} (Avg: {player.avg})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Stat Name (auto-filled) */}
        <div className="input-group">
          <label>Stat:</label>
          <input
            type="text"
            value={leg.stat || categories.find(c => c.id === leg.statCategory)?.name || ''}
            disabled
            className="disabled-input"
          />
        </div>

        {/* Threshold */}
        <div className="input-group">
          <label>Threshold:</label>
          {leg.player ? (
            <div className="threshold-selector">
              <input
                type="text"
                placeholder="e.g., 230+"
                value={leg.threshold || ''}
                onChange={(e) => onUpdate(index, 'threshold', e.target.value)}
              />
              <div className="suggested-thresholds">
                {suggestedThresholds().map(thresh => (
                  <button
                    key={thresh}
                    type="button"
                    onClick={() => onUpdate(index, 'threshold', thresh)}
                    className="threshold-suggestion"
                  >
                    {thresh}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <input type="text" placeholder="Select player first..." disabled />
          )}
        </div>

        {/* Confidence */}
        <div className="input-group">
          <label>Confidence:</label>
          <select
            value={leg.confidence}
            onChange={(e) => onUpdate(index, 'confidence', e.target.value)}
          >
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </div>
    </div>
  );
}
