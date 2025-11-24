// FILE LOCATION: src/components/LegForm.jsx
import '../styles/LegForm.css';

export default function LegForm({ leg, index, onUpdate, onRemove, canRemove }) {
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
        <div className="input-group">
          <label>Player Name:</label>
          <input
            type="text"
            placeholder="e.g., Patrick Mahomes"
            value={leg.player}
            onChange={(e) => onUpdate(index, 'player', e.target.value)}
          />
        </div>

        <div className="input-group">
          <label>Stat Type:</label>
          <input
            type="text"
            placeholder="e.g., Passing Yards, Points, Rebounds"
            value={leg.stat}
            onChange={(e) => onUpdate(index, 'stat', e.target.value)}
          />
        </div>

        <div className="input-group">
          <label>Threshold:</label>
          <input
            type="text"
            placeholder="e.g., 230+, 25+, 50+"
            value={leg.threshold}
            onChange={(e) => onUpdate(index, 'threshold', e.target.value)}
          />
        </div>

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
