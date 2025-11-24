// FILE LOCATION: src/components/PickCard.jsx
import { useState } from 'react';
import { CheckCircle, AlertCircle, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import '../styles/PickCard.css';

export default function PickCard({ pick }) {
  const [expanded, setExpanded] = useState(false);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'won':
        return <CheckCircle size={24} color="#28a745" />;
      case 'lost':
        return <TrendingDown size={24} color="#dc3545" />;
      default:
        return <Clock size={24} color="#ffc107" />;
    }
  };

  const getStatusLabel = (status) => {
    if (status === 'analyzed' || status === 'pending_analysis') return 'PENDING';
    return status?.toUpperCase() || 'PENDING';
  };

  const getStatusColor = (status) => {
    if (status === 'won') return '#28a745';
    if (status === 'lost') return '#dc3545';
    return '#ffc107';
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp.seconds ? timestamp.seconds * 1000 : timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="pick-card">
      <div className="pick-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="pick-card-main">
          <div className="status-icon">
            {getStatusIcon(pick.status)}
          </div>

          <div className="pick-info">
            <div className="pick-title">
              <span className="sport-badge">{pick.sport}</span>
              <span className="game">{pick.game}</span>
            </div>
            <div className="pick-meta">
              <span className="date">{formatDate(pick.submittedAt)}</span>
              <span className="legs">{pick.originalLegs?.length} legs</span>
              <span className="wager">${pick.wager}</span>
            </div>
          </div>
        </div>

        <div className="pick-status">
          <div 
            className="status-badge"
            style={{ backgroundColor: getStatusColor(pick.status) }}
          >
            {getStatusLabel(pick.status)}
          </div>
          {pick.result?.actualROI !== undefined && (
            <div className={`roi ${pick.result.actualROI >= 0 ? 'positive' : 'negative'}`}>
              {pick.result.actualROI > 0 ? '+' : ''}{pick.result.actualROI}%
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="pick-card-details">
          {/* Recommendation */}
          {pick.analysis?.recommendation && (
            <div className="detail-section">
              <h4>Analysis</h4>
              <div className="recommendation" style={{ borderLeftColor: getStatusColor(pick.analysis.recommendation) }}>
                <strong>Recommendation:</strong> {pick.analysis.recommendation}
                <br />
                <strong>Confidence:</strong> {pick.analysis.overallConfidence}%
              </div>
            </div>
          )}

          {/* Legs */}
          <div className="detail-section">
            <h4>Legs ({pick.originalLegs?.length})</h4>
            <div className="legs-list">
              {pick.originalLegs?.map((leg, i) => (
                <div key={i} className="leg-item">
                  <div className="leg-header">
                    <span className="leg-number">Leg {i + 1}</span>
                    <span className="leg-player">{leg.player}</span>
                  </div>
                  <div className="leg-details">
                    <span>{leg.stat} {leg.threshold}</span>
                    <span className="confidence">{leg.confidence}</span>
                  </div>
                  {pick.result?.legResults?.[i] && (
                    <div className="leg-result">
                      <span className={`result ${pick.result.legResults[i].result.toLowerCase()}`}>
                        {pick.result.legResults[i].result}
                      </span>
                      <span className="actual">
                        Actual: {pick.result.legResults[i].actualValue}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Results */}
          {pick.result && (
            <div className="detail-section">
              <h4>Results</h4>
              <div className="results-grid">
                <div className="result-item">
                  <span className="label">Legs Won</span>
                  <span className="value">{pick.result.legsWon}/{pick.result.totalLegs}</span>
                </div>
                <div className="result-item">
                  <span className="label">Wager</span>
                  <span className="value">${pick.wager}</span>
                </div>
                <div className="result-item">
                  <span className="label">Payout</span>
                  <span className="value">${pick.result.actualPayout?.toFixed(2)}</span>
                </div>
                <div className="result-item">
                  <span className="label">ROI</span>
                  <span className={`value ${pick.result.actualROI >= 0 ? 'positive' : 'negative'}`}>
                    {pick.result.actualROI > 0 ? '+' : ''}{pick.result.actualROI}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Reasoning */}
          {pick.reasoning && (
            <div className="detail-section">
              <h4>Reasoning</h4>
              <p className="reasoning">{pick.reasoning}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
