// FILE LOCATION: src/components/BetReceipt.jsx
// Displays extracted bet slip in a receipt format

import '../styles/BetReceipt.css';

// SVG Icons
const Icons = {
  Calendar: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  X: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Clock: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  DollarSign: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
  created_at = new Date().toISOString()
}) {
  console.log('🎨 BetReceipt rendering:', { sportsbook, picksCount: picks.length, status });
  
  // Format date
  const formatDate = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
  };

  // Get status badge
  const getStatusBadge = () => {
    const baseClass = 'br-status';
    
    if (status === 'complete') {
      if (profit_loss >= 0) {
        return {
          class: `${baseClass} br-status-won`,
          icon: Icons.Check,
          text: `Won ${formatCurrency(profit_loss)}`
        };
      } else {
        return {
          class: `${baseClass} br-status-lost`,
          icon: Icons.X,
          text: `Lost ${formatCurrency(Math.abs(profit_loss))}`
        };
      }
    } else {
      return {
        class: `${baseClass} br-status-pending`,
        icon: Icons.Clock,
        text: 'Pending Results'
      };
    }
  };

  const statusBadge = getStatusBadge();

  return (
    <div className={`bet-receipt status-${status === 'complete' ? (profit_loss >= 0 ? 'won' : 'lost') : 'pending'}`}>
      
      {/* Header */}
      <div className="br-header">
        <div className="br-header-left">
          <div className="br-sportsbook">{sportsbook}</div>
          <div className="br-date">
            <Icons.Calendar />
            <span>{formatDate(created_at)}</span>
          </div>
        </div>
        <div className={statusBadge.class}>
          <statusBadge.icon />
          <span>{statusBadge.text}</span>
        </div>
      </div>

      {/* Picks */}
      <div className="br-picks">
        {picks.map((pick, index) => (
          <div key={index} className="br-pick">
            <div className="br-pick-num">{index + 1}</div>
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

      <div className="br-divider" />

      {/* Wager Section */}
      <div className="br-wager-section">
        {parlay_legs && (
          <div className="br-wager-row">
            <span className="br-label">Parlay Legs</span>
            <span className="br-value">{parlay_legs}</span>
          </div>
        )}
        <div className="br-wager-row">
          <span className="br-label">Wager Amount</span>
          <span className="br-value">
            <Icons.DollarSign />
            {formatCurrency(wager_amount)}
          </span>
        </div>
        
        <div className="br-potential">
          <div className="br-wager-row">
            <span className="br-label br-potential-text">Potential Payout</span>
            <span className="br-value br-potential-text">
              <Icons.DollarSign />
              {formatCurrency(potential_payout)}
            </span>
          </div>
        </div>
      </div>

      {/* Result (if completed) */}
      {status === 'complete' && profit_loss !== null && (
        <div className={`br-result ${profit_loss >= 0 ? 'br-win' : 'br-loss'}`}>
          <div className="br-wager-row">
            <span className="br-label">Final Result</span>
            <span className={`br-value br-result-text ${profit_loss >= 0 ? 'br-win-text' : 'br-loss-text'}`}>
              <Icons.DollarSign />
              {profit_loss >= 0 ? '+' : ''}{formatCurrency(profit_loss)}
            </span>
          </div>
        </div>
      )}

      {/* Analysis */}
      {analysis && (
        <div className="br-analysis">
          <div className="br-analysis-label">Personalized Analysis</div>
          <div className="br-analysis-text">
            {analysis}
          </div>
        </div>
      )}
    </div>
  );
}
