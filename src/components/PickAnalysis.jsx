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

      {/* Quick Stats */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Recommendation</div>
          <div className="metric-value" style={{ color: getRecommendationColor(analysis.recommendation) }}>
            {analysis.recommendation}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Parlay Legs</div>
          <div className="metric-value">{analysis.legCount}</div>
        </div>
      </div>

      {/* Green Flags */}
      {analysis.greenFlags && analysis.greenFlags.length > 0 && (
        <div className="analysis-section">
          <h4>✅ Strengths</h4>
          <ul className="analysis-list green-list">
            {analysis.greenFlags.map((flag, i) => (
              <li key={i}>{flag}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Red Flags */}
      {analysis.redFlags && analysis.redFlags.length > 0 && (
        <div className="analysis-section">
          <h4><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:"4px",verticalAlign:"middle"}}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Concerns</h4>
          <ul className="analysis-list red-list">
            {analysis.redFlags.map((flag, i) => (
              <li key={i}>{flag}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Claude AI Reasoning */}
      {analysis.reasoning && (
        <div className="analysis-section">
          <h4>🤖 AI Analysis</h4>
          <div className="claude-reasoning">
            {analysis.reasoning}
          </div>
        </div>
      )}
    </div>
  );
}
