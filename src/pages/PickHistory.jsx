// FILE LOCATION: src/pages/PickHistory.jsx
import { useState, useEffect } from 'react';
import { db, auth } from '../firebase/config';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import PickCard from '../components/PickCard';
import '../styles/PickHistory.css';

export default function PickHistory() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, pending, won, lost
  const [stats, setStats] = useState({
    total: 0,
    won: 0,
    lost: 0,
    pending: 0,
    winRate: 0,
    totalROI: 0
  });

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'users', auth.currentUser.uid, 'submitted_picks'),
      orderBy('submittedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const picksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setPicks(picksData);
      calculateStats(picksData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const calculateStats = (picksData) => {
    const total = picksData.length;
    const won = picksData.filter(p => p.status === 'won').length;
    const lost = picksData.filter(p => p.status === 'lost').length;
    const pending = picksData.filter(p => p.status === 'analyzed' || p.status === 'pending_analysis').length;

    let totalROI = 0;
    picksData.forEach(pick => {
      if (pick.result?.actualROI) {
        totalROI += pick.result.actualROI;
      }
    });

    const winRate = total > 0 ? (won / (won + lost)) || 0 : 0;

    setStats({
      total,
      won,
      lost,
      pending,
      winRate: Math.round(winRate * 1000) / 10,
      totalROI: Math.round(totalROI * 100) / 100
    });
  };

  const filteredPicks = picks.filter(pick => {
    if (filter === 'all') return true;
    if (filter === 'pending') return pick.status === 'analyzed' || pick.status === 'pending_analysis';
    return pick.status === filter;
  });

  if (loading) {
    return <div className="pick-history-container"><div className="loading">Loading picks...</div></div>;
  }

  return (
    <div className="pick-history-container">
      <h2>Pick History</h2>

      {/* Stats Summary */}
      <div className="stats-summary">
        <div className="stat-card">
          <div className="stat-label">Total Picks</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Win Rate</div>
          <div className="stat-value">{stats.winRate}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total ROI</div>
          <div className="stat-value" style={{ color: stats.totalROI >= 0 ? '#28a745' : '#dc3545' }}>
            {stats.totalROI}%
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Won / Lost / Pending</div>
          <div className="stat-value">{stats.won} / {stats.lost} / {stats.pending}</div>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="filter-buttons">
        <button 
          className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({picks.length})
        </button>
        <button 
          className={`filter-btn ${filter === 'pending' ? 'active' : ''}`}
          onClick={() => setFilter('pending')}
        >
          Pending ({stats.pending})
        </button>
        <button 
          className={`filter-btn ${filter === 'won' ? 'active' : ''}`}
          onClick={() => setFilter('won')}
        >
          Won ({stats.won})
        </button>
        <button 
          className={`filter-btn ${filter === 'lost' ? 'active' : ''}`}
          onClick={() => setFilter('lost')}
        >
          Lost ({stats.lost})
        </button>
      </div>

      {/* Picks List */}
      <div className="picks-list">
        {filteredPicks.length === 0 ? (
          <div className="no-picks">No picks found</div>
        ) : (
          filteredPicks.map(pick => (
            <PickCard key={pick.id} pick={pick} />
          ))
        )}
      </div>
    </div>
  );
}
