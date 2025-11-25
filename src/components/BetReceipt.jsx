// FILE LOCATION: src/components/BetReceipt.jsx
// Displays a formatted "receipt" of the user's bet slip reconstructed from extracted data

import '../styles/BetReceipt.css';

// SVG Icons
const Icons = {
  Calendar: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  DollarSign: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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
  Clock: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
};

export default function BetReceipt({ bet }) {
  if (!bet) return null;

  const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date.toDate ? date.toDate() : date);
    return d.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending_results':
        return 'pending';
      case 'complete':
        return bet.profit_loss > 0 ? 'won' : 'lost';
      default:
        return 'pending';
    }
  };

  const getStatusIcon = (status) => {
    if (status === 'complete') {
      return bet.profit_loss > 0 ? <Icons.Check /> : <Icons.X />;
    }
    return <Icons.Clock />;
  };

  const getStatusText = (status) => {
    if (status === 'complete') {
      return bet.profit_loss > 0 ? 'Won' : 'Lost';
    }
    return 'Pending';
  };

  return (
    <div className={`bet-receipt status-${getStatusColor(bet.status)}`}>
      {/* Header */}
      <div className="br-header">
        <div className="br-header-left">
          <div className="br-sportsbook">{bet.sportsbook}</div>
          <div className="br-date">
            <Icons.Calendar />
            {formatDate(bet.created_at)}
          </div>
        </div>
        <div className={`br-status br-status-${getStatusColor(bet.status)}`}>
          {getStatusIcon(bet.status)}
          <span>{getStatusText(bet.status)}</span>
        </div>
      </div>

      {/* Picks List */}
      <div className="br-picks">
        {bet.picks && bet.picks.map((pick, idx) => (
          <div key={idx} className="br-pick">
            <div className="br-pick-num">{idx + 1}</div>
            <div className="br-pick-details">
              <div className="br-pick-player">{pick.player}</div>
              <div className="br-pick-stat">
                {pick.stat} {pick.bet_type} {pick.line}
              </div>
            </div>
            <div className="br-pick-odds">{pick.odds > 0 ? '+' : ''}{pick.odds}</div>
          </div>
        ))}
      </div>

      {/* Divider */}
      <div className="br-divider" />

      {/* Wager & Payout */}
      <div className="br-wager-section">
        <div className="br-wager-row">
          <span className="br-label">Wager</span>
          <span className="br-value">
            <Icons.DollarSign />
            {bet.wager_amount?.toFixed(2) || '0.00'}
          </span>
        </div>

        {bet.parlay_legs && (
          <div className="br-wager-row">
            <span className="br-label">Parlay Legs</span>
            <span className="br-value">{bet.parlay_legs}</span>
          </div>
        )}

        {bet.status === 'pending_results' && bet.potential_payout && (
          <div className="br-wager-row br-potential">
            <span className="br-label">Potential Payout</span>
            <span className="br-value br-potential-text">
              <Icons.DollarSign />
              {bet.potential_payout?.toFixed(2) || '0.00'}
            </span>
          </div>
        )}

        {bet.status === 'complete' && bet.profit_loss !== null && (
          <div className={`br-wager-row br-result ${bet.profit_loss > 0 ? 'br-win' : 'br-loss'}`}>
            <span className="br-label">Profit/Loss</span>
            <span className={`br-value br-result-text ${bet.profit_loss > 0 ? 'br-win-text' : 'br-loss-text'}`}>
              <Icons.DollarSign />
              {bet.profit_loss > 0 ? '+' : ''}{bet.profit_loss?.toFixed(2) || '0.00'}
            </span>
          </div>
        )}
      </div>

      {/* Analysis (if available) */}
      {bet.analysis && (
        <div className="br-analysis">
          <div className="br-analysis-label">Analysis</div>
          <div className="br-analysis-text">{bet.analysis}</div>
        </div>
      )}
    </div>
  );
}
