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
          <h4>⚠️ Concerns</h4>
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
