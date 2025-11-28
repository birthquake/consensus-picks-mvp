// FILE LOCATION: src/pages/History.jsx
// Improved bet history with better cards and buttons

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
  ChevronRight: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
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
  )
};

export default function History() {
  const [activeStatus, setActiveStatus] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');

  // Mock data
  const bets = [
    {
      id: 1,
      sportsbook: 'DraftKings',
      date: '2025-11-27',
      status: 'pending',
      grade: 'N/A'
    },
    {
      id: 2,
      sportsbook: 'FanDuel',
      date: '2025-11-26',
      status: 'won',
      grade: 'A'
    },
    {
      id: 3,
      sportsbook: 'DraftKings',
      date: '2025-11-26',
      status: 'lost',
      grade: 'C'
    },
    {
      id: 4,
      sportsbook: 'BetMGM',
      date: '2025-11-25',
      status: 'pending',
      grade: 'N/A'
    }
  ];

  const statusCounts = {
    all: bets.length,
    pending: bets.filter(b => b.status === 'pending').length,
    won: bets.filter(b => b.status === 'won').length,
    lost: bets.filter(b => b.status === 'lost').length
  };

  const statusOptions = [
    { id: 'all', label: 'All', icon: null },
    { id: 'pending', label: 'Pending', icon: null },
    { id: 'won', label: 'Won', icon: null },
    { id: 'lost', label: 'Lost', icon: null }
  ];

  const filteredBets = activeStatus === 'all' 
    ? bets 
    : bets.filter(b => b.status === activeStatus);

  const sortedBets = [...filteredBets].sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
  });

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
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
          <button className="filter-btn">
            <Icons.Filter />
            <span>Filters</span>
            <div className="filter-badge">1</div>
          </button>
        </div>
      </div>

      {/* Bet Cards */}
      {sortedBets.length > 0 ? (
        <div className="bet-cards">
          {sortedBets.map(bet => {
            const statusInfo = getStatusInfo(bet.status);
            const gradeClass = getGradeClass(bet.grade);

            return (
              <div key={bet.id} className="bet-card">
                <div className="bet-card-content">
                  <div className="bet-card-icon">
                    <Icons.Sportsbook />
                  </div>
                  <div className="bet-card-info">
                    <h3 className="bet-card-title">{bet.sportsbook}</h3>
                    <div className="bet-card-meta">
                      <div className="bet-card-meta-item">
                        <Icons.Calendar />
                        <span>{formatDate(bet.date)}</span>
                      </div>
                      <div className="bet-card-meta-item">
                        <Icons.Clock />
                        <statusInfo.icon style={{ width: '14px', height: '14px' }} />
                        <span>{statusInfo.label}</span>
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
                  <div className="bet-card-chevron">
                    <Icons.ChevronRight />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <Icons.Sportsbook />
          <h3>No Bets Found</h3>
          <p>Upload your first bet slip to see it here</p>
        </div>
      )}
    </div>
  );
}
