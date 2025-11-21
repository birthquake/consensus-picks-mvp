// FILE LOCATION: src/App.jsx

import { useEffect, useState } from 'react';
import './App.css';
import Dashboard from './components/Dashboard';

export default function App() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sport, setSport] = useState('all');
  const [minConsensus, setMinConsensus] = useState(2);

  const fetchPicks = async () => {
    try {
      setLoading(true);
      const url = `/api/picks/get-picks?sport=${sport}&minConsensus=${minConsensus}&limit=100`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.success) {
        setPicks(data.picks);
        setError(null);
      } else {
        setError('Failed to fetch picks');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPicks();
    // Refresh picks every 5 minutes
    const interval = setInterval(fetchPicks, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [sport, minConsensus]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Consensus Picks</h1>
        <p>Sports Betting Picks by Consensus Strength</p>
      </header>

      <div className="filters">
        <div className="filter-group">
          <label>Sport:</label>
          <select value={sport} onChange={(e) => setSport(e.target.value)}>
            <option value="all">All Sports</option>
            <option value="nba">NBA</option>
            <option value="nfl">NFL</option>
            <option value="nhl">NHL</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Minimum Consensus:</label>
          <select value={minConsensus} onChange={(e) => setMinConsensus(e.target.value)}>
            <option value="2">2+ Sources</option>
            <option value="3">3+ Sources</option>
            <option value="4">4+ Sources</option>
          </select>
        </div>

        <button onClick={fetchPicks} className="refresh-btn">
          Refresh Now
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Loading picks...</div>}
      {!loading && !error && <Dashboard picks={picks} />}
    </div>
  );
}
