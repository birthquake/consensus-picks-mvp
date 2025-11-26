// FILE LOCATION: src/pages/Dashboard.jsx
// Phase 3: User performance dashboard with analytics

import { useState, useEffect } from 'react';
import { db, auth } from '../firebase/config';
import { collection, query, where, getDocs } from 'firebase/firestore';
import '../styles/Dashboard.css';

// SVG Icons
const Icons = {
  TrendingUp: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 17" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  DollarSign: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  Target: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  AlertCircle: () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
};

export default function Dashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAnalytics = async () => {
      if (!auth.currentUser) {
        setError('You must be logged in');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError('');

        // Fetch all completed bets to get latest analytics
        const q = query(
          collection(db, 'users', auth.currentUser.uid, 'bets'),
          where('status', '==', 'complete')
        );

        const snapshot = await getDocs(q);
        const bets = snapshot.docs.map(doc => doc.data());

        if (bets.length === 0) {
          // No completed bets yet, show empty state
          setAnalytics(null);
          setLoading(false);
          return;
        }

        // Get analytics from the most recent bet (it contains the snapshot)
        const mostRecentBet = bets.sort((a, b) => 
          new Date(b.created_at) - new Date(a.created_at)
        )[0];

        setAnalytics(mostRecentBet.user_analytics_snapshot);
      } catch (err) {
        console.error('Error fetching analytics:', err);
        setError('Failed to load your dashboard');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, []);

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="d-container">
        <div className="d-header">
          <h1>Your Dashboard</h1>
          <p>Performance analytics and insights</p>
        </div>
        <div className="d-loading">
          <p>Loading your statistics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="d-container">
        <div className="d-header">
          <h1>Your Dashboard</h1>
          <p>Performance analytics and insights</p>
        </div>
        <div className="d-error">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="d-container">
        <div className="d-header">
          <h1>Your Dashboard</h1>
          <p>Performance analytics and insights</p>
        </div>
        <div className="d-empty">
          <Icons.AlertCircle />
          <h2>No completed bets yet</h2>
          <p>Upload and complete some bets to see your performance analytics</p>
        </div>
      </div>
    );
  }

  return (
    <div className="d-container">
      {/* Header */}
      <div className="d-header">
        <h1>Your Dashboard</h1>
        <p>Performance analytics and insights</p>
      </div>

      {/* Key Metrics */}
      <div className="d-metrics">
        <div className="d-metric-card">
          <div className="d-metric-icon">
            <Icons.Target />
          </div>
          <div className="d-metric-content">
            <div className="d-metric-label">Win Rate</div>
            <div className="d-metric-value">{analytics.win_rate}%</div>
            <div className="d-metric-subtext">{analytics.wins} wins, {analytics.losses} losses</div>
          </div>
        </div>

        <div className="d-metric-card">
          <div className="d-metric-icon trending">
            <Icons.TrendingUp />
          </div>
          <div className="d-metric-content">
            <div className="d-metric-label">ROI</div>
            <div className="d-metric-value">{analytics.roi}%</div>
            <div className="d-metric-subtext">Return on investment</div>
          </div>
        </div>

        <div className="d-metric-card">
          <div className="d-metric-icon profit">
            <Icons.DollarSign />
          </div>
          <div className="d-metric-content">
            <div className="d-metric-label">Total Profit</div>
            <div className={`d-metric-value ${analytics.total_profit >= 0 ? 'positive' : 'negative'}`}>
              {analytics.total_profit >= 0 ? '+' : ''}{formatCurrency(analytics.total_profit)}
            </div>
            <div className="d-metric-subtext">{analytics.total_bets} bets tracked</div>
          </div>
        </div>
      </div>

      {/* Category Performance */}
      {Object.keys(analytics.by_category).length > 0 && (
        <div className="d-section">
          <h2>Performance by Category</h2>
          <div className="d-category-list">
            {Object.entries(analytics.by_category).map(([category, data]) => {
              const rate = data.total > 0 ? Math.round((data.wins / data.total) * 100) : 0;
              const isHighPerformer = rate >= analytics.win_rate + 10;
              const isLowPerformer = rate <= analytics.win_rate - 10;
              
              return (
                <div key={category} className={`d-category-item ${isHighPerformer ? 'high' : isLowPerformer ? 'low' : ''}`}>
                  <div className="d-category-name">{category.replace(/_/g, ' ')}</div>
                  <div className="d-category-stats">
                    <span className="d-category-rate">{rate}%</span>
                    <span className="d-category-detail">{data.wins}/{data.total}</span>
                  </div>
                  <div className="d-category-bar">
                    <div className="d-category-fill" style={{ width: `${rate}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* League Performance */}
      {Object.keys(analytics.by_league).length > 0 && (
        <div className="d-section">
          <h2>Performance by League</h2>
          <div className="d-league-grid">
            {Object.entries(analytics.by_league).map(([league, data]) => {
              const rate = data.total > 0 ? Math.round((data.wins / data.total) * 100) : 0;
              return (
                <div key={league} className="d-league-card">
                  <div className="d-league-name">{league}</div>
                  <div className="d-league-rate">{rate}%</div>
                  <div className="d-league-detail">{data.wins}W - {data.total - data.wins}L</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Best and Worst */}
      <div className="d-section">
        <h2>Your Strengths & Weaknesses</h2>
        <div className="d-best-worst">
          {analytics.best_category !== 'N/A' && (
            <div className="d-best-card">
              <div className="d-bw-label">Best Category</div>
              <div className="d-bw-category">{analytics.best_category.replace(/_/g, ' ')}</div>
              <div className="d-bw-rate">{analytics.best_rate}%</div>
            </div>
          )}

          {analytics.worst_category !== 'N/A' && (
            <div className="d-worst-card">
              <div className="d-bw-label">Worst Category</div>
              <div className="d-bw-category">{analytics.worst_category.replace(/_/g, ' ')}</div>
              <div className="d-bw-rate">{analytics.worst_rate}%</div>
            </div>
          )}
        </div>
      </div>

      {/* Insights */}
      <div className="d-section d-insights">
        <h2>Insights</h2>
        <ul className="d-insight-list">
          {analytics.win_rate >= 55 && (
            <li>✓ Your overall win rate of {analytics.win_rate}% is solid for sports betting</li>
          )}
          {analytics.win_rate < 50 && (
            <li>⚠ Your win rate is below 50% - consider focusing on your best categories</li>
          )}
          {analytics.best_category !== 'N/A' && analytics.best_rate > analytics.win_rate + 15 && (
            <li>✓ You excel at {analytics.best_category.replace(/_/g, ' ')} ({analytics.best_rate}%)</li>
          )}
          {analytics.worst_category !== 'N/A' && analytics.worst_rate < analytics.win_rate - 15 && (
            <li>⚠ {analytics.worst_category.replace(/_/g, ' ')} is your weakest area ({analytics.worst_rate}%)</li>
          )}
          {analytics.roi >= 10 && (
            <li>✓ Your ROI of {analytics.roi}% shows positive long-term results</li>
          )}
          {analytics.roi < 0 && (
            <li>⚠ Your ROI is negative - track which picks aren't working</li>
          )}
        </ul>
      </div>
    </div>
  );
}
