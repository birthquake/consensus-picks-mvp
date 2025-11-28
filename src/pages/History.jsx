// FILE LOCATION: src/pages/History.jsx
// Bet history with real Firebase data, expandable cards, working filters

import { useState, useEffect } from 'react';
import { auth } from '../firebase/firebase-config';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/firebase-config';
import '../styles/History.css';

// Icons
const Icons = {
  Calendar: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Clock: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Sportsbook: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
      <line x1="7" y1="8" x2="17" y2="8" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="7" y1="16" x2="17" y2="16" />
    </svg>
  ),
  Check: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  X: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Clock2: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  ChevronDown: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  Sort: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="12 5 19 12 12 19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Filter: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  Close: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
};

export default function History() {
  // State
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeStatus, setActiveStatus] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [expandedId, setExpandedId] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [gradeFilter, setGradeFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');

  // Fetch bets from Firebase
  useEffect(() => {
    const fetchBets = async () => {
      try {
        setLoading(true);
        const user = auth.currentUser;
        
        if (!user) {
          setError('Not logged in');
          setLoading(false);
          return;
        }

        // Reference to user's bets subcollection
        const betsRef = collection(db, 'users', user.uid, 'bets');
        const snapshot = await getDocs(betsRef);
        
        const fetchedBets = [];
        snapshot.forEach(doc => {
          fetchedBets.push({
            id: doc.id,
            ...doc.data()
          });
        });

        setBets(fetchedBets);
        setError(null);
      } catch (err) {
        console.error('Error fetching bets:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchBets();
  }, []);

  // Get bet type from parlay_legs
  const getBetType = (paralyLegs) => {
    if (!paralyLegs) return 'Unknown';
    if (paralyLegs === 1) return 'Single Bet';
    if (paralyLegs === 2) return '2-Leg Parlay';
    if (paralyLegs === 3) return '3-Leg Parlay';
    if (paralyLegs === 4) return '4-Leg Parlay';
    return `${paralyLegs}-Leg Parlay`;
  };

  // Map Firebase status to display status
  const mapStatus = (firebaseStatus) => {
    if (firebaseStatus === 'pending_results') return 'pending';
    if (firebaseStatus === 'completed_won') return 'won';
    if (firebaseStatus === 'completed_lost') return 'lost';
    return 'pending';
  };

  // Calculate grade based on analysis or placeholder
  const getGrade = (bet) => {
    // If you add a grade field to Firebase, use it here
    // For now, returning N/A for pending, A/C for won/lost as example
    const status = mapStatus(bet.status);
    if (status === 'pending') return 'N/A';
    if (status === 'won') return 'A';
    return 'C';
  };

  // Format date
  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric'
    });
  };

  // Get status info
  const getStatusInfo = (status) => {
    if (status === 'pending') {
      return { class: 'pending', icon: Icons.Clock2, label: 'Pending' };
    } else if (status === 'won') {
      return { class: 'won', icon: Icons.Check, label: 'Won' };
    } else {
      return { class: 'lost', icon: Icons.X, label: 'Lost' };
    }
  };

  // Get grade class
  const getGradeClass = (grade) => {
    if (grade === 'N/A') return 'grade-na';
    const letter = grade.charAt(0).toLowerCase();
    return `grade-${letter}`;
  };

  // Count statuses
  const statusCounts = {
    all: bets.length,
    pending: bets.filter(b => mapStatus(b.status) === 'pending').length,
    won: bets.filter(b => mapStatus(b.status) === 'won').length,
    lost: bets.filter(b => mapStatus(b.status) === 'lost').length
  };

  // Apply filters
  let filtered = activeStatus === 'all' 
    ? [...bets] 
    : bets.filter(b => mapStatus(b.status) === activeStatus);

  if (gradeFilter !== 'all') {
    filtered = filtered.filter(b => {
      const grade = getGrade(b);
      if (gradeFilter === 'na') return grade === 'N/A';
      return grade.toLowerCase() === gradeFilter.toLowerCase();
    });
  }

  if (dateRange !== 'all') {
    const now = new Date();
    filtered = filtered.filter(b => {
      const betDate = b.created_at?.toDate ? b.created_at.toDate() : new Date(b.created_at);
      if (dateRange === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return betDate >= weekAgo;
      }
      if (dateRange === 'month') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return betDate >= monthAgo;
      }
      return true;
    });
  }

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const dateA = a.created_at?.toDate ? a.created_at.toDate() : new Date(a.created_at);
    const dateB = b.created_at?.toDate ? b.created_at.toDate() : new Date(b.created_at);
    return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
  });

  const activeFiltersCount = (gradeFilter !== 'all' ? 1 : 0) + (dateRange !== 'all' ? 1 : 0);

  if (loading) {
    return (
      <div className="history-page">
        <div className="history-header">
          <h2>Your Bets</h2>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="history-page">
        <div className="history-header">
          <h2>Your Bets</h2>
          <p>Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="history-page">
      {/* Header */}
      <div className="history-header">
        <h2>Your Bets</h2>
        <p>History of your uploaded bet slips and analysis</p>
      </div>

      {/* Filters */}
      <div className="filters-section">
        {/* Status Buttons */}
        <div className="filter-group">
          <label>Status</label>
          <div className="status-buttons">
            {['all', 'pending', 'won', 'lost'].map(status => (
              <button
                key={status}
                className={`status-btn ${activeStatus === status ? 'active' : ''}`}
                onClick={() => setActiveStatus(status)}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
                <span>{statusCounts[status]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sort/Filter Row */}
        <div className="sort-filter-row">
          <button 
            className="sort-btn"
            onClick={() => setSortOrder(sortOrder === 'newest' ? 'oldest' : 'newest')}
          >
            <Icons.Sort />
            <span>{sortOrder === 'newest' ? 'Newest First' : 'Oldest First'}</span>
          </button>
          <button 
            className={`filter-btn ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Icons.Filter />
            <span>Filters</span>
            {activeFiltersCount > 0 && <div className="filter-badge">{activeFiltersCount}</div>}
          </button>
        </div>

        {/* Filter Modal */}
        {showFilters && (
          <div className="filter-modal">
            <div className="filter-modal-header">
              <h3>Filters</h3>
              <button className="filter-close" onClick={() => setShowFilters(false)}>
                <Icons.Close />
              </button>
            </div>

            <div className="filter-modal-content">
              <div className="filter-section">
                <label>Grade</label>
                <div className="filter-options">
                  {['all', 'a', 'b', 'c', 'd', 'f', 'na'].map(grade => (
                    <button
                      key={grade}
                      className={`filter-option ${gradeFilter === grade ? 'active' : ''}`}
                      onClick={() => setGradeFilter(grade)}
                    >
                      {grade === 'all' ? 'All Grades' : grade === 'na' ? 'N/A' : grade.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-section">
                <label>Date Range</label>
                <div className="filter-options">
                  {[
                    { id: 'all', label: 'All Time' },
                    { id: 'week', label: 'Last 7 Days' },
                    { id: 'month', label: 'Last 30 Days' }
                  ].map(range => (
                    <button
                      key={range.id}
                      className={`filter-option ${dateRange === range.id ? 'active' : ''}`}
                      onClick={() => setDateRange(range.id)}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-modal-footer">
                <button 
                  className="filter-reset"
                  onClick={() => {
                    setGradeFilter('all');
                    setDateRange('all');
                  }}
                >
                  Reset Filters
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bet Cards */}
      {sorted.length > 0 ? (
        <div className="bet-cards">
          {sorted.map(bet => {
            const status = mapStatus(bet.status);
            const statusInfo = getStatusInfo(status);
            const grade = getGrade(bet);
            const gradeClass = getGradeClass(grade);
            const isExpanded = expandedId === bet.id;
            const betType = getBetType(bet.parlay_legs);

            return (
              <div key={bet.id} className={`bet-card ${isExpanded ? 'expanded' : ''}`}>
                <button
                  className="bet-card-button"
                  onClick={() => setExpandedId(isExpanded ? null : bet.id)}
                  type="button"
                >
                  <div className="bet-card-content">
                    <div className="bet-card-icon">
                      <Icons.Sportsbook />
                    </div>
                    <div className="bet-card-info">
                      <h3 className="bet-card-title">
                        {betType} • {formatDate(bet.created_at)}
                      </h3>
                      <div className="bet-card-meta">
                        <div className="bet-card-meta-item">
                          {bet.parlay_legs} Pick{bet.parlay_legs !== 1 ? 's' : ''}
                        </div>
                        <div className="bet-card-meta-item">
                          ${bet.wager_amount?.toFixed(2)} wager
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bet-card-status">
                    <div className={`grade-badge-small ${gradeClass}`}>
                      {grade}
                    </div>
                    <div className={`status-badge ${statusInfo.class}`}>
                      <statusInfo.icon />
                      <span>{statusInfo.label}</span>
                    </div>
                    <div className={`bet-card-chevron ${isExpanded ? 'expanded' : ''}`}>
                      <Icons.ChevronDown />
                    </div>
                  </div>
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="bet-card-expanded">
                    <div className="expanded-picks">
                      <h4>Picks</h4>
                      {bet.picks && bet.picks.map((pick, idx) => (
                        <div key={idx} className="expanded-pick">
                          <span className="pick-num">{idx + 1}</span>
                          <span>
                            {pick.player} {pick.stat} {pick.bet_type} {pick.line}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="expanded-details">
                      <div className="detail-row">
                        <span>Wager</span>
                        <span>${bet.wager_amount?.toFixed(2)}</span>
                      </div>
                      <div className="detail-row">
                        <span>Potential Win</span>
                        <span className="accent">${bet.potential_payout?.toFixed(2) || 'N/A'}</span>
                      </div>
                      {status !== 'pending' && (
                        <div className={`detail-row result ${bet.profit_loss >= 0 ? 'won' : 'lost'}`}>
                          <span>Result</span>
                          <span>{bet.profit_loss >= 0 ? '+' : ''}{bet.profit_loss >= 0 ? '$' : '-$'}{Math.abs(bet.profit_loss).toFixed(2)}</span>
                        </div>
                      )}
                    </div>

                    {bet.analysis && (
                      <div className="expanded-analysis">
                        <h4>Analysis</h4>
                        <p>{bet.analysis}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <Icons.Sportsbook />
          <h3>No Bets Found</h3>
          <p>Try adjusting your filters or upload your first bet slip</p>
        </div>
      )}
    </div>
  );
}
