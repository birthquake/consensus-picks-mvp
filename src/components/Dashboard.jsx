// FILE LOCATION: src/components/Dashboard.jsx

import '../styles/Dashboard.css';

export default function Dashboard({ picks }) {
  if (picks.length === 0) {
    return (
      <div className="dashboard empty">
        <p>No picks found. Check back later!</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="picks-summary">
        <p>{picks.length} consensus picks found</p>
      </div>

      <div className="picks-grid">
        {picks.map((pick) => (
          <div key={pick.id} className="pick-card">
            <div className="pick-header">
              <span className="sport-badge">{pick.sport.toUpperCase()}</span>
              <span className="consensus-badge">
                {pick.consensusStrength} sources
              </span>
            </div>

            <div className="pick-content">
              <div className="pick-suggestion">
                <p className="pick-label">Recommended Pick</p>
                <p className="pick-text">{pick.pick}</p>
              </div>

              <div className="pick-confidence">
                <div className="confidence-label">
                  <span>Confidence</span>
                  <span className="confidence-value">{pick.confidenceScore}%</span>
                </div>
                <div className="confidence-bar">
                  <div
                    className="confidence-fill"
                    style={{ width: `${pick.confidenceScore}%` }}
                  ></div>
                </div>
              </div>

              <div className="pick-metadata">
                <p className="pick-type">{pick.pickType}</p>
                <p className="pick-status">{pick.pickStatus}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
