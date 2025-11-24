// FILE LOCATION: src/pages/Dashboard.jsx
import { useState, useEffect } from 'react';
import { db, auth } from '../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { TrendingUp, AlertCircle, Target } from 'lucide-react';
import '../styles/Dashboard.css';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        if (!auth.currentUser) {
          console.log('❌ No user logged in');
          setError('Not authenticated');
          setLoading(false);
          return;
        }

        console.log('📊 Fetching dashboard stats for user:', auth.currentUser.uid);

        const statsDocRef = doc(
          db,
          'users',
          auth.currentUser.uid,
          'performance_stats',
          'overall'
        );

        const statsDoc = await getDoc(statsDocRef);

        if (statsDoc.exists()) {
          console.log('✅ Stats found:', statsDoc.data());
          setStats(statsDoc.data());
        } else {
          console.log('📊 No stats document yet - submit picks and wait for cron job');
          setStats(null);
        }

        setLoading(false);
      } catch (err) {
        console.error('❌ Error fetching stats:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container">
        <div className="error-state">
          <AlertCircle size={48} />
          <h3>Error Loading Dashboard</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!stats || stats.totalSubmitted === 0) {
    return (
      <div className="dashboard-container">
        <div className="empty-state">
          <Target size={48} />
          <h3>No data yet</h3>
          <p>Submit some picks and wait for results to see your dashboard.</p>
          <p style={{ fontSize: '12px', color: '#999', marginTop: '10px' }}>
            📅 Results are processed daily at 1 AM UTC
          </p>
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
            {stats.totalWon + stats.totalLost > 0 
              ? ((stats.totalWon / (stats.totalWon + stats.totalLost)) * 100).toFixed(1)
              : '0'
            }%
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
            Based on {stats.totalWon} wins
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
              : 'Gathering data...'}
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
          <h3>Top Players by Hit Rate</h3>
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
        <h3>Insights</h3>
        <div className="insights">
          {stats.totalWon + stats.totalLost >= 10 && stats.currentWinRate >= 0.5 ? (
            <div className="insight positive">
              <TrendingUp size={20} />
              <div>
                <strong>Strong Performance</strong>
                <p>Your {(stats.currentWinRate * 100).toFixed(1)}% win rate is profitable. Keep focusing on high-confidence picks!</p>
              </div>
            </div>
          ) : stats.totalWon + stats.totalLost >= 10 ? (
            <div className="insight warning">
              <AlertCircle size={20} />
              <div>
                <strong>Room to Improve</strong>
                <p>Your {(stats.currentWinRate * 100).toFixed(1)}% win rate needs improvement. Focus on the legs Claude recommends.</p>
              </div>
            </div>
          ) : null}

          {stats.bestSport && stats.sportBreakdown && Object.keys(stats.sportBreakdown).length > 1 && (
            <div className="insight">
              <Target size={20} />
              <div>
                <strong>Your Edge</strong>
                <p>You're strongest in {stats.bestSport}. Consider allocating more picks to this sport.</p>
              </div>
            </div>
          )}

          {stats.overallROI > 0 && (
            <div className="insight positive">
              <TrendingUp size={20} />
              <div>
                <strong>Profitable</strong>
                <p>Your strategy shows +{stats.overallROI}% ROI. You have an edge!</p>
              </div>
            </div>
          )}

          {stats.totalSubmitted < 20 && (
            <div className="insight">
              <Target size={20} />
              <div>
                <strong>Build Sample Size</strong>
                <p>You have {stats.totalSubmitted} picks. Need 50+ results to validate your edge with confidence.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Last Updated */}
      {stats.lastUpdated && (
        <div className="last-updated">
          Last updated: {new Date(stats.lastUpdated).toLocaleString()}
        </div>
      )}
    </div>
  );
}
