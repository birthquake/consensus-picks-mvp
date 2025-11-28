// FILE LOCATION: src/pages/History.jsx
// Improved bet history with expandable cards and working filters

import { useState } from 'react';
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
  const [activeStatus, setActiveStatus] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [expandedId, setExpandedId] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [gradeFilter, setGradeFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');

  // Mock data with more details
  const bets = [
    {
      id: 1,
      date: '2025-11-27',
      time: '11:45 AM',
      status: 'pending',
      grade: 'N/A',
      picks: 3,
      wager: 50,
      potential: 1247.50,
      pickDetails: [
        'LeBron James O 24.5 Pts',
        'Lakers vs Celtics ML',
        'Jalen Brunson O 18.5 Ast'
      ]
    },
    {
      id: 2,
      date: '2025-11-26',
      time: '2:30 PM',
      status: 'won',
      grade: 'A',
      picks: 2,
      wager: 100,
      potential: 380,
      result: 320,
      pickDetails: [
        'Kansas City ML',
        'Patrick Mahomes O 250 Yards'
      ]
    },
    {
      id: 3,
      date: '2025-11-26',
      time: '9:15 AM',
      status: 'lost',
      grade: 'C',
      picks: 1,
      wager: 75,
      potential: 200,
      result: -75,
      pickDetails: [
        'New York Giants +3.5'
      ]
    },
    {
      id: 4,
      date: '2025-11-25',
      time: '3:20 PM',
      status: 'pending',
      grade: 'N/A',
      picks: 4,
      wager: 25,
      potential: 890,
      pickDetails: [
        'Boston Celtics ML',
        'Jayson Tatum O 26.5 Pts',
        'Derrick White U 15.5 Ast',
        'Game Total O 215.5'
      ]
    }
  ];

  const statusCounts = {
    all: bets.length,
    pending: bets.filter(b => b.status === 'pending').length,
    won: bets.filter(b => b.status === 'won').length,
    lost: bets.filter(b => b.status === 'lost').length
  };

  const statusOptions = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'won', label: 'Won' },
    { id: 'lost', label: 'Lost' }
  ];

  // Apply filters
  let filteredBets = activeStatus === 'all' 
    ? bets 
    : bets.filter(b => b.status === activeStatus);

  if (gradeFilter !== 'all') {
    filteredBets = filteredBets.filter(b => {
      if (gradeFilter === 'na') return b.grade === 'N/A';
      return b.grade.toLowerCase() === gradeFilter.toLowerCase();
    });
  }

  if (dateRange !== 'all') {
    const now = new Date();
    filteredBets = filteredBets.filter(b => {
      const betDate = new Date(b.date);
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

  const sortedBets = [...filteredBets].sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
  });

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric'
    });
  };

  const getStatusInfo = (status) => {
    if (status === 'pending') {
      return { class: 'pending', icon: Icons.Clock2, label: 'Pending' };
    } else if (status === 'won') {
      return { class: 'won', icon: Icons.Check, label: 'Won' };
    } else {
      return { class: 'lost', icon: Icons.X, label: 'Lost' };
    }
  };

  const getGradeClass = (grade) => {
    if (grade === 'N/A') return 'grade-na';
    const letter = grade.charAt(0).toLowerCase();
    return `grade-${letter}`;
  };

  const activeFiltersCount = (gradeFilter !== 'all' ? 1 : 0) + (dateRange !== 'all' ? 1 : 0);

  return (
    <div className="history-page">
      {/* Header */}
      <div className="history-header">
        <h2>Your Bets</h2>
        <p>History of your uploaded bet slips and analysis</p>
      </div>

      {/* Filters */}
      <div className="filters-section">
        <div className="filter-group">
          <label>Status</label>
          <div className="status-buttons">
            {statusOptions.map(option => (
              <button
                key={option.id}
                className={`status-btn ${activeStatus === option.id ? 'active' : ''}`}
                onClick={() => setActiveStatus(option.id)}
              >
                {option.label}
                <span style={{ marginLeft: '0.35rem', fontSize: '0.8rem' }}>
                  {statusCounts[option.id]}
                </span>
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
            className="filter-btn"
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
      {sortedBets.length > 0 ? (
        <div className="bet-cards">
          {sortedBets.map(bet => {
            const statusInfo = getStatusInfo(bet.status);
            const gradeClass = getGradeClass(bet.grade);
            const isExpanded = expandedId === bet.id;

            return (
              <div 
                key={bet.id} 
                className={`bet-card ${isExpanded ? 'expanded' : ''}`}
              >
                <button
                  className="bet-card-button"
                  onClick={() => setExpandedId(isExpanded ? null : bet.id)}
                >
                  <div className="bet-card-content">
                    <div className="bet-card-icon">
                      <Icons.Sportsbook />
                    </div>
                    <div className="bet-card-info">
                      <h3 className="bet-card-title">Bet Slip • {formatDate(bet.date)} {bet.time}</h3>
                      <div className="bet-card-meta">
                        <div className="bet-card-meta-item">
                          {bet.picks} Pick{bet.picks !== 1 ? 's' : ''}
                        </div>
                        <div className="bet-card-meta-item">
                          ${bet.wager.toFixed(2)} wager
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bet-card-status">
                    <div className={`grade-badge-small ${gradeClass}`}>
                      {bet.grade}
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
                      {bet.pickDetails.map((pick, idx) => (
                        <div key={idx} className="expanded-pick">
                          <span className="pick-num">{idx + 1}</span>
                          <span>{pick}</span>
                        </div>
                      ))}
                    </div>

                    <div className="expanded-details">
                      <div className="detail-row">
                        <span>Wager</span>
                        <span>${bet.wager.toFixed(2)}</span>
                      </div>
                      <div className="detail-row">
                        <span>Potential Win</span>
                        <span className="accent">${bet.potential.toFixed(2)}</span>
                      </div>
                      {bet.status !== 'pending' && (
                        <div className={`detail-row ${bet.result >= 0 ? 'won' : 'lost'}`}>
                          <span>Result</span>
                          <span>{bet.result >= 0 ? '+' : ''}{bet.result >= 0 ? '$' : '-$'}{Math.abs(bet.result).toFixed(2)}</span>
                        </div>
                      )}
                    </div>
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
