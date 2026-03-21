// FILE LOCATION: src/pages/History.jsx

import { useState, useEffect } from 'react';
import { auth, db } from '../firebase/config';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import '../styles/History.css';

const Icons = {
  Calendar: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>),
  Clock2: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>),
  Check: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>),
  X: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>),
  ChevronDown: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>),
  Sort: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="12 5 19 12 12 19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>),
  Filter: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>),
  Close: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>),
  Sportsbook: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="17" y2="16"/></svg>),
  TrendUp: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>),
  TrendDown: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>),
  Alert: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>),
};

// ── ESPN Form Bar ─────────────────────────────────────────────────────────────
// Shows a spark-bar of last 5 game values vs the bet line

function FormBar({ values, line, stat }) {
  if (!values || values.length === 0) return null;
  const nums = values.filter(v => v !== null && v !== 'DNP' && !isNaN(Number(v))).map(Number);
  if (nums.length === 0) return null;
  const max = Math.max(...nums, line || 0) * 1.2 || 1;

  return (
    <div className="form-bar-wrap">
      <span className="form-bar-label">{stat} last {values.length}</span>
      <div className="form-bars">
        {values.map((v, i) => {
          const num = Number(v);
          const isDNP = v === 'DNP' || v === null || isNaN(num);
          const hit = line != null && !isDNP && num > line;
          const height = isDNP ? 20 : Math.round((num / max) * 48);
          return (
            <div key={i} className="form-bar-col">
              <div
                className={`form-bar-fill ${hit ? 'hit' : 'miss'} ${isDNP ? 'dnp' : ''}`}
                style={{ height: `${height}px` }}
                title={isDNP ? 'DNP' : `${num} ${hit ? '✓' : '✗'}`}
              />
              <span className="form-bar-val">{isDNP ? '-' : num}</span>
            </div>
          );
        })}
      </div>
      {line != null && (
        <div className="form-line-label">line: {line}</div>
      )}
    </div>
  );
}

// ── Per-pick enrichment row ───────────────────────────────────────────────────

function PickEnrichmentRow({ pick, enrichment, outcome }) {
  const hasForm = enrichment?.recentForm?.length > 0;
  const injured = enrichment?.injuryStatus && enrichment.injuryStatus !== 'Active' && enrichment.injuryStatus !== 'Unknown';
  const values = enrichment?.recentForm?.map(g => g.value ?? 'DNP') || [];

  // Trend: compare most recent 2 vs older games
  let trend = null;
  const nums = values.filter(v => v !== 'DNP' && !isNaN(Number(v))).map(Number);
  if (nums.length >= 4) {
    const recent = (nums[0] + nums[1]) / 2;
    const older = nums.slice(2).reduce((a, b) => a + b, 0) / nums.slice(2).length;
    if (recent > older * 1.12) trend = 'up';
    else if (recent < older * 0.88) trend = 'down';
  }

  // Outcome dot
  let outcomeEl = null;
  if (outcome) {
    const won = outcome.result === 'Won';
    const voided = outcome.result === 'VOID';
    outcomeEl = (
      <span className={`outcome-dot ${won ? 'won' : voided ? 'void' : 'lost'}`}>
        {won ? '✓' : voided ? '–' : '✗'} {outcome.final_value != null ? outcome.final_value : ''}
      </span>
    );
  }

  return (
    <div className="enrich-pick-row">
      <div className="enrich-pick-header">
        <span className="enrich-pick-num">{pick.sport}</span>
        <span className="enrich-pick-name">
          {enrichment?.playerFullName || pick.player}
          {injured && (
            <span className="injury-badge"><Icons.Alert /> {enrichment.injuryStatus}</span>
          )}
        </span>
        <span className="enrich-pick-bet">
          {pick.stat} {pick.bet_type} {pick.line}
          {trend === 'up' && <span className="trend-up"><Icons.TrendUp /> Hot</span>}
          {trend === 'down' && <span className="trend-down"><Icons.TrendDown /> Cold</span>}
        </span>
        {outcomeEl}
      </div>
      {hasForm && (
        <FormBar values={values} line={pick.line} stat={pick.stat} />
      )}
      {!hasForm && enrichment && !enrichment.error && (
        <div className="form-unavailable">Form data unavailable for this player</div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function History() {
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeStatus, setActiveStatus] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [expandedId, setExpandedId] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [gradeFilter, setGradeFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');

  const handleDeleteBet = async (betId) => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      await updateDoc(doc(db, 'users', user.uid, 'bets', betId), {
        archived: true, archivedAt: new Date()
      });
      setBets(bets.filter(b => b.id !== betId));
      setExpandedId(null);
    } catch (err) {
      console.error('Error archiving bet:', err);
    }
  };

  useEffect(() => {
    const fetchBets = async () => {
      try {
        setLoading(true);
        const user = auth.currentUser;
        if (!user) { setError('Not logged in'); return; }
        const snapshot = await getDocs(collection(db, 'users', user.uid, 'bets'));
        const fetched = [];
        snapshot.forEach(d => {
          const bet = { id: d.id, ...d.data() };
          if (!bet.archived) fetched.push(bet);
        });
        setBets(fetched);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchBets();
  }, []);

  const getBetType = (legs) => {
    if (!legs) return 'Unknown';
    if (legs === 1) return 'Single';
    return `${legs}-Leg Parlay`;
  };

  const mapStatus = (s) => {
    if (s === 'pending_results') return 'pending';
    if (s === 'complete') return (/* determined below */ s);
    return s || 'pending';
  };

  const resolveStatus = (bet) => {
    if (bet.status === 'complete') {
      if (bet.bet_result === 'Won') return 'won';
      if (bet.bet_result === 'Lost') return 'lost';
      if (bet.bet_result === 'VOID') return 'void';
      return bet.profit_loss > 0 ? 'won' : 'lost';
    }
    return mapStatus(bet.status);
  };

  const getGrade = (bet) => bet.grade || 'N/A';

  const formatDate = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const statusInfo = (status) => ({
    pending: { cls: 'pending', icon: Icons.Clock2, label: 'Pending' },
    won:     { cls: 'won',     icon: Icons.Check,  label: 'Won' },
    lost:    { cls: 'lost',    icon: Icons.X,      label: 'Lost' },
    void:    { cls: 'void',    icon: Icons.X,      label: 'Void' },
  }[status] || { cls: 'pending', icon: Icons.Clock2, label: 'Pending' });

  const gradeClass = (g) => g === 'N/A' ? 'grade-na' : `grade-${g.charAt(0).toLowerCase()}`;

  const statusCounts = {
    all:     bets.length,
    pending: bets.filter(b => resolveStatus(b) === 'pending').length,
    won:     bets.filter(b => resolveStatus(b) === 'won').length,
    lost:    bets.filter(b => resolveStatus(b) === 'lost').length,
  };

  let filtered = activeStatus === 'all'
    ? [...bets]
    : bets.filter(b => resolveStatus(b) === activeStatus);

  if (gradeFilter !== 'all') {
    filtered = filtered.filter(b => {
      const g = getGrade(b);
      return gradeFilter === 'na' ? g === 'N/A' : g.toLowerCase() === gradeFilter;
    });
  }

  if (dateRange !== 'all') {
    const now = Date.now();
    const cutoff = dateRange === 'week' ? 7 : 30;
    filtered = filtered.filter(b => {
      const d = b.created_at?.toDate ? b.created_at.toDate() : new Date(b.created_at);
      return (now - d.getTime()) <= cutoff * 86400000;
    });
  }

  const sorted = [...filtered].sort((a, b) => {
    const dA = a.created_at?.toDate ? a.created_at.toDate() : new Date(a.created_at);
    const dB = b.created_at?.toDate ? b.created_at.toDate() : new Date(b.created_at);
    return sortOrder === 'newest' ? dB - dA : dA - dB;
  });

  const activeFiltersCount = (gradeFilter !== 'all' ? 1 : 0) + (dateRange !== 'all' ? 1 : 0);

  if (loading) return <div className="history-page"><div className="history-header"><h2>Your Bets</h2><p>Loading...</p></div></div>;
  if (error)   return <div className="history-page"><div className="history-header"><h2>Your Bets</h2><p>Error: {error}</p></div></div>;

  return (
    <div className="history-page">
      <div className="history-header">
        <h2>Your Bets</h2>
        <p>History of your uploaded bet slips and analysis</p>
      </div>

      <div className="filters-section">
        <div className="filter-group">
          <label>Status</label>
          <div className="status-buttons">
            {['all','pending','won','lost'].map(s => (
              <button key={s} className={`status-btn ${activeStatus === s ? 'active' : ''}`}
                onClick={() => setActiveStatus(s)}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
                <span>{statusCounts[s]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sort-filter-row">
          <button className="sort-btn" onClick={() => setSortOrder(o => o === 'newest' ? 'oldest' : 'newest')}>
            <Icons.Sort /><span>{sortOrder === 'newest' ? 'Newest First' : 'Oldest First'}</span>
          </button>
          <button className={`filter-btn ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(v => !v)}>
            <Icons.Filter /><span>Filters</span>
            {activeFiltersCount > 0 && <div className="filter-badge">{activeFiltersCount}</div>}
          </button>
        </div>

        {showFilters && (
          <div className="filter-modal">
            <div className="filter-modal-header">
              <h3>Filters</h3>
              <button className="filter-close" onClick={() => setShowFilters(false)}><Icons.Close /></button>
            </div>
            <div className="filter-modal-content">
              <div className="filter-section">
                <label>Grade</label>
                <div className="filter-options">
                  {['all','a','b','c','d','f','na'].map(g => (
                    <button key={g} className={`filter-option ${gradeFilter === g ? 'active' : ''}`}
                      onClick={() => setGradeFilter(g)}>
                      {g === 'all' ? 'All Grades' : g === 'na' ? 'N/A' : g.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="filter-section">
                <label>Date Range</label>
                <div className="filter-options">
                  {[{id:'all',label:'All Time'},{id:'week',label:'Last 7 Days'},{id:'month',label:'Last 30 Days'}].map(r => (
                    <button key={r.id} className={`filter-option ${dateRange === r.id ? 'active' : ''}`}
                      onClick={() => setDateRange(r.id)}>{r.label}</button>
                  ))}
                </div>
              </div>
              <div className="filter-modal-footer">
                <button className="filter-reset" onClick={() => { setGradeFilter('all'); setDateRange('all'); }}>Reset Filters</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {sorted.length > 0 ? (
        <div className="bet-cards">
          {sorted.map(bet => {
            const status   = resolveStatus(bet);
            const si       = statusInfo(status);
            const grade    = getGrade(bet);
            const gc       = gradeClass(grade);
            const isExp    = expandedId === bet.id;
            const enrichments = bet.espn_enrichment || [];

            return (
              <div key={bet.id} className={`bet-card ${isExp ? 'expanded' : ''}`}>
                <button className="bet-card-button"
                  onClick={() => setExpandedId(isExp ? null : bet.id)} type="button">
                  <div className="bet-card-content">
                    <div className="bet-card-icon"><Icons.Sportsbook /></div>
                    <div className="bet-card-info">
                      <h3 className="bet-card-title">
                        {getBetType(bet.parlay_legs)} • {formatDate(bet.created_at)}
                      </h3>
                      <div className="bet-card-meta">
                        <div className="bet-card-meta-item">{bet.parlay_legs} Pick{bet.parlay_legs !== 1 ? 's' : ''}</div>
                        <div className="bet-card-meta-item">${bet.wager_amount?.toFixed(2)} wager</div>
                        {bet.game_date && (
                          <div className="bet-card-meta-item game-date-meta">
                            <Icons.Calendar /> {bet.game_date}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="bet-card-status">
                    <div className={`grade-badge-small ${gc}`}>{grade}</div>
                    <div className={`status-badge ${si.cls}`}>
                      <si.icon /><span>{si.label}</span>
                    </div>
                    <div className={`bet-card-chevron ${isExp ? 'expanded' : ''}`}><Icons.ChevronDown /></div>
                  </div>
                </button>

                {isExp && (
                  <div className="bet-card-expanded">

                    {/* ── Player form section ── */}
                    {bet.picks && bet.picks.length > 0 && (
                      <div className="expanded-section">
                        <h4>
                          Picks & Form
                          {enrichments.filter(e => !e.error).length > 0 && (
                            <span className="espn-badge">ESPN data</span>
                          )}
                        </h4>
                        <div className="enrich-picks-list">
                          {bet.picks.map((pick, idx) => (
                            <PickEnrichmentRow
                              key={idx}
                              pick={pick}
                              enrichment={enrichments[idx] || null}
                              outcome={bet.outcomes?.[idx] || null}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Financials ── */}
                    <div className="expanded-details">
                      <div className="detail-row">
                        <span>Wager</span>
                        <span>${bet.wager_amount?.toFixed(2)}</span>
                      </div>
                      <div className="detail-row">
                        <span>Potential Win</span>
                        <span className="accent">${bet.potential_payout?.toFixed(2) || 'N/A'}</span>
                      </div>
                      {status !== 'pending' && bet.profit_loss != null && (
                        <div className={`detail-row result ${bet.profit_loss >= 0 ? 'won' : 'lost'}`}>
                          <span>Result</span>
                          <span>
                            {bet.profit_loss >= 0 ? '+$' : '-$'}{Math.abs(bet.profit_loss).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* ── Claude analysis ── */}
                    {bet.analysis && (
                      <div className="expanded-analysis">
                        <h4>AI Analysis</h4>
                        {bet.analysis.pickAnalysis && <p>{bet.analysis.pickAnalysis}</p>}
                        {bet.analysis.strengths?.length > 0 && (
                          <>
                            <h5>Strengths</h5>
                            <ul>{bet.analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                          </>
                        )}
                        {bet.analysis.risks?.length > 0 && (
                          <>
                            <h5>Risks</h5>
                            <ul>{bet.analysis.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                          </>
                        )}
                        {bet.analysis.recommendedAdjustments && (
                          <>
                            <h5>Recommendations</h5>
                            <p>{bet.analysis.recommendedAdjustments}</p>
                          </>
                        )}
                      </div>
                    )}

                    <button className="delete-bet-btn"
                      onClick={() => {
                        if (confirm('Remove this bet from history? (kept for analytics)')) {
                          handleDeleteBet(bet.id);
                        }
                      }}>
                      Remove from History
                    </button>
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
