// FILE LOCATION: src/pages/Dashboard.jsx
import { useState, useEffect } from 'react';
import { db, auth } from '../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { TrendingUp, TrendingDown, AlertCircle, Target } from 'lucide-react';
import '../styles/Dashboard.css';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.currentUser) return;

    const fetchStats = async () => {
      try {
        const statsRef = doc(
          db,
          'users',
          auth.currentUser.uid,
          'performance_stats',
          'overall'
        );
        const statsDoc = await getDoc(statsRef);

        if (statsDoc.exists()) {
          setStats(statsDoc.data());
        }
        setLoading(false);
      } catch (err) {
        console.error('Error fetching stats:', err);
        setLoading(false);
      }
    };

    fetchStats();

    // Listen for real-time updates
    const unsubscribe = db
      .collection('users')
      .doc(auth.currentUser.uid)
      .collection('performance_stats')
      .doc('overall')
      .onSnapshot((doc) => {
        if (doc.exists()) {
          setStats(doc.data());
        }
      });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return <div className="dashboard-container"><div className="loading">Loading dashboard...</div></div>;
  }

  if (!stats) {
    return (
      <div className="dashboard-container">
        <div className="empty-state">
          <Target size={48} />
          <h3>No data yet</h3>
          <p>Submit some picks and wait for results to see your dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <h2>Your Performance Dashboard</h2>

      {/* Main KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Win Rate</span>
            <TrendingUp size={20} />
          </div>
          <div className="kpi-value">
            {(stats.currentWinRate * 100).toFixed(1)}%
          </div>
          <div className="kpi-meta">
            {stats.totalWon} wins / {stats.totalWon + stats.totalLost} settled
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Total ROI</span>
            <TrendingUp size={20} />
          </div>
          <div className={`kpi-value ${stats.overallROI >= 0 ? 'positive' : 'negative'}`}>
            {stats.overallROI > 0 ? '+' : ''}{stats.overallROI}%
          </div>
          <div className="kpi-meta">
            {stats.totalWon} wins × average odds
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Total Picks</span>
            <Target size={20} />
          </div>
          <div className="kpi-value">{stats.totalSubmitted}</div>
          <div className="kpi-meta">
            {stats.totalWon}W / {stats.totalLost}L
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Best Sport</span>
            <TrendingUp size={20} />
          </div>
          <div className="kpi-value">{stats.bestSport || 'N/A'}</div>
          <div className="kpi-meta">
            {stats.bestSport && stats.sportBreakdown?.[stats.bestSport]
              ? `${(stats.sportBreakdown[stats.bestSport].winRate * 100).toFixed(1)}% win rate`
              : 'Not enough data'}
          </div>
        </div>
      </div>

      {/* Sport Breakdown */}
      {stats.sportBreakdown && Object.keys(stats.sportBreakdown).length > 0 && (
        <div className="section">
          <h3>Performance by Sport</h3>
          <div className="sport-breakdown">
            {Object.entries(stats.sportBreakdown).map(([sport, data]) => (
              <div key={sport} className="sport-card">
                <div className="sport-header">
                  <h4>{sport}</h4>
                  <div className="sport-record">
                    {data.won}W - {data.lost}L
                  </div>
                </div>
                <div className="sport-metrics">
                  <div className="metric">
                    <span className="label">Win Rate</span>
                    <span className="value">
                      {(data.winRate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="metric">
                    <span className="label">Avg ROI</span>
                    <span className={`value ${data.avgROI >= 0 ? 'positive' : 'negative'}`}>
                      {data.avgROI > 0 ? '+' : ''}{data.avgROI}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Players */}
      {stats.playerBreakdown && Object.keys(stats.playerBreakdown).length > 0 && (
        <div className="section">
          <h3>Player Performance</h3>
          <div className="players-list">
            {Object.entries(stats.playerBreakdown)
              .sort((a, b) => b[1].hitRate - a[1].hitRate)
              .slice(0, 10)
              .map(([player, data]) => (
                <div key={player} className="player-item">
                  <div className="player-name">{player}</div>
                  <div className="player-stats">
                    <span className="hit-rate">
                      {data.hits}/{data.total} ({(data.hitRate * 100).toFixed(0)}%)
                    </span>
                    <div className="hit-bar">
                      <div 
                        className="hit-fill"
                        style={{ width: `${data.hitRate * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Insights */}
      <div className="section">
        <h3>Insights & Recommendations</h3>
        <div className="insights">
          {stats.currentWinRate >= 0.5 ? (
            <div className="insight positive">
              <TrendingUp size={20} />
              <div>
                <strong>Strong Performance</strong>
                <p>Your {(stats.currentWinRate * 100).toFixed(1)}% win rate is above average. Keep it up!</p>
              </div>
            </div>
          ) : stats.totalSubmitted > 0 ? (
            <div className="insight warning">
              <AlertCircle size={20} />
              <div>
                <strong>Room to Improve</strong>
                <p>Current {(stats.currentWinRate * 100).toFixed(1)}% win rate. Focus on high-confidence legs.</p>
              </div>
            </div>
          ) : null}

          {stats.sportBreakdown && Object.keys(stats.sportBreakdown).length > 1 && (
            <div className="insight">
              <Target size={20} />
              <div>
                <strong>Focus Your Edge</strong>
                <p>
                  You're strongest in {stats.bestSport}. Consider focusing more picks on this sport.
                </p>
              </div>
            </div>
          )}

          {stats.overallROI > 0 && (
            <div className="insight positive">
              <TrendingUp size={20} />
              <div>
                <strong>Profitable Strategy</strong>
                <p>Your strategy is showing +{stats.overallROI}% ROI. You have an edge!</p>
              </div>
            </div>
          )}

          {stats.totalSubmitted < 10 && (
            <div className="insight">
              <Target size={20} />
              <div>
                <strong>Build Sample Size</strong>
                <p>You have {stats.totalSubmitted} picks. Need 50+ to validate your edge.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Last Updated */}
      <div className="last-updated">
        Last updated: {new Date(stats.lastUpdated).toLocaleString()}
      </div>
    </div>
  );
}
