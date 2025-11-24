// FILE LOCATION: src/components/PickAnalysis.jsx
import '../styles/PickAnalysis.css';

export default function PickAnalysis({ analysis }) {
  if (!analysis) return null;

  const getRecommendationColor = (rec) => {
    switch (rec) {
      case 'BET':
        return '#28a745';
      case 'REFINE':
        return '#ffc107';
      case 'SKIP':
        return '#dc3545';
      default:
        return '#6c757d';
    }
  };

  const getLegStrengthColor = (score) => {
    if (score >= 80) return '#28a745';
    if (score >= 60) return '#ffc107';
    if (score >= 40) return '#ff9800';
    return '#dc3545';
  };

  return (
    <div className="pick-analysis">
      <div className="analysis-header">
        <h3>Analysis Results</h3>
        <div 
          className="recommendation-badge"
          style={{ backgroundColor: getRecommendationColor(analysis.recommendation) }}
        >
          {analysis.recommendation}
        </div>
      </div>

      {/* Overall Metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Overall Confidence</div>
          <div className="metric-value">{analysis.overallConfidence}%</div>
          <div className="metric-bar">
            <div 
              className="metric-fill"
              style={{ width: `${analysis.overallConfidence}%` }}
            />
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Expected Hit Rate</div>
          <div className="metric-value">{(analysis.expectedHitRate * 100).toFixed(1)}%</div>
          <div className="metric-bar">
            <div 
              className="metric-fill"
              style={{ width: `${analysis.expectedHitRate * 100}%` }}
            />
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Estimated ROI</div>
          <div className="metric-value" style={{ 
            color: analysis.estimatedROI > 0 ? '#28a745' : '#dc3545'
          }}>
            {analysis.estimatedROI}%
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Refined Legs</div>
          <div className="metric-value">{analysis.refinedLegCount}</div>
        </div>
      </div>

      {/* Strengths */}
      {analysis.strengths.length > 0 && (
        <div className="analysis-section">
          <h4>✅ Strengths</h4>
          <ul className="analysis-list">
            {analysis.strengths.map((strength, i) => (
              <li key={i}>{strength}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Issues */}
      {analysis.issues.length > 0 && (
        <div className="analysis-section">
          <h4>⚠️ Issues</h4>
          <ul className="analysis-list error-list">
            {analysis.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {analysis.warnings.length > 0 && (
        <div className="analysis-section">
          <h4>⚡ Warnings</h4>
          <ul className="analysis-list warning-list">
            {analysis.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Leg-by-Leg Analysis */}
      <div className="analysis-section">
        <h4>Leg-by-Leg Breakdown</h4>
        <div className="legs-analysis">
          {analysis.legAnalysis.map((leg, i) => (
            <div key={i} className="leg-analysis-item">
              <div className="leg-analysis-header">
                <div className="leg-number">Leg {leg.legNumber}</div>
                <div className="leg-player">{leg.player} - {leg.stat} {leg.threshold}</div>
                <div 
                  className="leg-score"
                  style={{ backgroundColor: getLegStrengthColor(leg.score) }}
                >
                  {leg.score}/100
                </div>
              </div>

              <div className="leg-analysis-details">
                <div className="detail-row">
                  <span className="label">Strength:</span>
                  <span className={`strength ${leg.strength.toLowerCase()}`}>
                    {leg.strength}
                  </span>
                </div>

                {leg.dataPoints.playerAverage && (
                  <div className="detail-row">
                    <span className="label">Player Avg:</span>
                    <span>{leg.dataPoints.playerAverage}</span>
                  </div>
                )}

                {leg.dataPoints.buffer !== undefined && (
                  <div className="detail-row">
                    <span className="label">Buffer:</span>
                    <span className={leg.dataPoints.buffer > 0 ? 'positive' : 'negative'}>
                      {leg.dataPoints.buffer > 0 ? '+' : ''}{leg.dataPoints.buffer.toFixed(1)}
                    </span>
                  </div>
                )}

                {leg.strengths.length > 0 && (
                  <div className="detail-row">
                    <span className="label">Strengths:</span>
                    <div className="sub-list">
                      {leg.strengths.map((s, j) => (
                        <div key={j} className="sub-item">✓ {s}</div>
                      ))}
                    </div>
                  </div>
                )}

                {leg.issues.length > 0 && (
                  <div className="detail-row">
                    <span className="label">Issues:</span>
                    <div className="sub-list error">
                      {leg.issues.map((issue, j) => (
                        <div key={j} className="sub-item">✗ {issue}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Removed Legs */}
      {analysis.removedLegs.length > 0 && (
        <div className="analysis-section">
          <h4>🗑️ Legs to Remove</h4>
          <div className="removed-legs">
            {analysis.removedLegs.map((leg, i) => (
              <div key={i} className="removed-leg-item">
                <div className="removed-leg-header">
                  Leg {leg.legNumber}: {leg.player}
                </div>
                <div className="removed-leg-reason">
                  {leg.reason}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggested Additions */}
      {analysis.suggestedAdditions.length > 0 && (
        <div className="analysis-section">
          <h4>➕ Suggested Additions</h4>
          <div className="suggested-additions">
            {analysis.suggestedAdditions.map((add, i) => (
              <div key={i} className="suggested-item">
                <div className="suggested-header">
                  {add.player} - {add.stat} {add.threshold}
                </div>
                <div className="suggested-reason">
                  {add.reason}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
