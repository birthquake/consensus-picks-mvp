// FILE LOCATION: src/pages/History.jsx
// Phase 2: Display user's bet history with filtering and sorting

import { useState, useEffect } from 'react';
import { db, auth } from '../firebase/config';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import BetReceipt from '../components/BetReceipt';
import '../styles/History.css';

// SVG Icons
const Icons = {
  Filter: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  Clock: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
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

export default function History() {
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all'); // 'all', 'pending_results', 'complete'
  const [sortBy, setSortBy] = useState('newest'); // 'newest' or 'oldest'

  useEffect(() => {
    const fetchBets = async () => {
      if (!auth.currentUser) {
        setError('You must be logged in');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError('');

        // Build query based on status filter
        let q;
        if (selectedStatus === 'all') {
          q = query(
            collection(db, 'users', auth.currentUser.uid, 'bets'),
            orderBy('created_at', 'desc')
          );
        } else {
          q = query(
            collection(db, 'users', auth.currentUser.uid, 'bets'),
            where('status', '==', selectedStatus),
            orderBy('created_at', 'desc')
          );
        }

        const snapshot = await getDocs(q);
        const fetchedBets = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        console.log('📊 Fetched bets for status:', selectedStatus);
        console.log('📊 Number of bets:', fetchedBets.length);
        console.log('📊 First few bets:', fetchedBets.slice(0, 2).map(b => ({ id: b.id, status: b.status, created_at: b.created_at })));

        // Sort based on sortBy preference
        if (sortBy === 'oldest') {
          fetchedBets.reverse();
        }

        setBets(fetchedBets);
      } catch (err) {
        console.error('Error fetching bets:', err);
        console.error('Error code:', err.code);
        console.error('Error message:', err.message);
        setError(`Failed to load your bets: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchBets();
  }, [selectedStatus, sortBy]);

  // Get counts for badges
  const pendingCount = bets.filter(b => b.status === 'pending_results').length;
  const wonCount = bets.filter(b => b.status === 'complete' && b.profit_loss > 0).length;
  const lostCount = bets.filter(b => b.status === 'complete' && b.profit_loss <= 0).length;

  // Filter bets for display
  let displayBets = bets;
  if (selectedStatus !== 'all') {
    displayBets = bets.filter(b => b.status === selectedStatus);
  }

  console.log('🎯 Rendering with:', {
    selectedStatus,
    totalBets: bets.length,
    displayBetsLength: displayBets.length,
    isEmpty: displayBets.length === 0,
    loading
  });

  // Further filter by result if complete
  if (selectedStatus === 'complete') {
    // This is handled by the status filter above, but if we want won/lost filters:
    // For now, 'complete' shows both won and lost
  }

  const isEmpty = displayBets.length === 0;

  return (
    <div className="h-container">
      {/* Header */}
      <div className="h-header">
        <h1>Your Bets</h1>
        <p>History of your uploaded bet slips and analysis</p>
      </div>

      {/* Filters */}
      <div className="h-filters">
        <div className="h-filter-section">
          <div className="h-filter-label">
            <Icons.Filter />
            <span>Status</span>
          </div>
          
          <div className="h-filter-buttons">
            <button
              className={`h-filter-btn ${selectedStatus === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('all')}
            >
              All
              <span className="h-badge">{bets.length}</span>
            </button>

            <button
              className={`h-filter-btn ${selectedStatus === 'pending_results' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('pending_results')}
            >
              Pending
              <span className="h-badge">{pendingCount}</span>
            </button>

            <button
              className={`h-filter-btn won ${selectedStatus === 'complete' && wonCount > 0 ? 'active' : ''}`}
              onClick={() => {
                // For now, clicking "Won" shows all completed bets
                // Can be refined later to separate won/lost
                setSelectedStatus('complete');
              }}
            >
              Won
              <span className="h-badge">{wonCount}</span>
            </button>

            <button
              className={`h-filter-btn lost ${selectedStatus === 'complete' && lostCount > 0 ? 'active' : ''}`}
              onClick={() => {
                setSelectedStatus('complete');
              }}
            >
              Lost
              <span className="h-badge">{lostCount}</span>
            </button>
          </div>
        </div>

        {/* Sort */}
        <div className="h-sort">
          <label htmlFor="sort">
            <Icons.Clock />
            <span>Sort</span>
          </label>
          <select
            id="sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-sort-select"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="h-content">
        {loading ? (
          <div className="h-loading">
            <p>Loading your bets...</p>
          </div>
        ) : error ? (
          <div className="h-error">
            <p>{error}</p>
          </div>
        ) : isEmpty ? (
          <div className="h-empty">
            <Icons.AlertCircle />
            <h2>No bets yet</h2>
            <p>Upload your first bet slip to get started</p>
          </div>
        ) : (
          <div className="h-bets-list">
            {displayBets.map(bet => (
              <BetReceipt
                key={bet.id}
                picks={bet.picks}
                sportsbook={bet.sportsbook}
                parlay_legs={bet.parlay_legs}
                wager_amount={bet.wager_amount}
                potential_payout={bet.potential_payout}
                analysis={bet.analysis}
                status={bet.status}
                profit_loss={bet.profit_loss}
                created_at={bet.created_at?.toDate?.() || new Date(bet.created_at)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
