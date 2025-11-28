// FILE LOCATION: src/components/BetReceipt.jsx
// Premium bet receipt card with SplitMates-inspired design

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import '../styles/BetReceipt.css';

// Icons
const Icons = {
  ChevronDown: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  X: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Calendar: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Clock: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  DollarSign: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
};

export default function BetReceipt({ 
  picks = [], 
  sportsbook = 'Sportsbook', 
  parlay_legs = null,
  wager_amount = 0, 
  potential_payout = 0, 
  analysis = '',
  status = 'pending_results',
  profit_loss = null,
  created_at = new Date().toISOString(),
  bet_grade = 'N/A',
  grade_reasoning = ''
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const formatDate = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const getGradeColor = (grade) => {
    if (!grade || grade === 'N/A') return 'grade-na';
    const letter = grade.charAt(0).toUpperCase();
    if (letter === 'A') return 'grade-a';
    if (letter === 'B') return 'grade-b';
    if (letter === 'C') return 'grade-c';
    if (letter === 'D') return 'grade-d';
    if (letter === 'F') return 'grade-f';
    return 'grade-na';
  };

  const getStatusInfo = () => {
    if (status === 'complete') {
      if (profit_loss >= 0) {
        return { class: 'status-won', icon: Icons.Check, text: `+${formatCurrency(profit_loss)}` };
      } else {
        return { class: 'status-lost', icon: Icons.X, text: formatCurrency(profit_loss) };
      }
    }
    return { class: 'status-pending', icon: Icons.Clock, text: 'Pending' };
  };

  const statusInfo = getStatusInfo();

  return (
    <div className={`bet-receipt ${getGradeColor(bet_grade)}`}>
      {/* Header/Toggle */}
      <button 
        className="receipt-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="header-left">
          <div className={`grade-badge ${getGradeColor(bet_grade)}`}>
            <span className="grade-letter">{bet_grade}</span>
          </div>
          <div className="header-info">
            <h3>{sportsbook}</h3>
            <div className="meta">
              <Icons.Calendar />
              <span>{formatDate(created_at)}</span>
            </div>
          </div>
        </div>
        <div className="header-right">
          <div className={`status-badge ${statusInfo.class}`}>
            <statusInfo.icon />
            <span>{statusInfo.text}</span>
          </div>
          <div className={`chevron ${isExpanded ? 'expanded' : ''}`}>
            <Icons.ChevronDown />
          </div>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="receipt-content">
          {/* Picks */}
          <div className="picks-section">
            <h4>Picks ({picks.length})</h4>
            <div className="picks-list">
              {picks.map((pick, idx) => (
                <div key={idx} className="pick-item">
                  <span className="pick-num">{idx + 1}</span>
                  <div className="pick-info">
                    <div className="pick-player">{pick.player}</div>
                    <div className="pick-stat">{pick.stat} {pick.bet_type} {pick.line}</div>
                  </div>
                  <div className="pick-odds">{pick.odds > 0 ? '+' : ''}{pick.odds}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Wager Info */}
          <div className="wager-section">
            {parlay_legs && (
              <div className="wager-row">
                <span className="label">Legs</span>
                <span className="value">{parlay_legs}</span>
              </div>
            )}
            <div className="wager-row">
              <span className="label">Wager</span>
              <span className="value">{formatCurrency(wager_amount)}</span>
            </div>
            <div className="wager-row highlight">
              <span className="label">Potential</span>
              <span className="value">{formatCurrency(potential_payout)}</span>
            </div>
          </div>

          {/* Result */}
          {status === 'complete' && profit_loss !== null && (
            <div className={`result-section ${profit_loss >= 0 ? 'won' : 'lost'}`}>
              <span className="label">Result</span>
              <span className={`value ${profit_loss >= 0 ? 'win' : 'loss'}`}>
                {profit_loss >= 0 ? '+' : ''}{formatCurrency(profit_loss)}
              </span>
            </div>
          )}

          {/* Analysis */}
          {analysis && (
            <div className="analysis-section">
              <h4>Analysis</h4>
              <div className="analysis-text">
                <ReactMarkdown>{analysis}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
