// FILE LOCATION: src/pages/Halftime.jsx
// Halftime Picks — live halftime game scanner + rated prop recommendations

import { useState, useEffect, useCallback } from 'react';

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icon = {
  Refresh: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  ),
  Star: ({ filled }) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  Plus: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Warning: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  Basketball: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10"/>
      <path d="M4.93 4.93c4.49 4.49 4.49 11.71 0 16.2"/><path d="M19.07 4.93c-4.49 4.49-4.49 11.71 0 16.2"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
    </svg>
  ),
  Zap: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  Clipboard: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
    </svg>
  ),
};

// ── Star Rating ───────────────────────────────────────────────────────────────
function StarRating({ rating }) {
  const color = rating >= 4 ? '#4ade80' : rating >= 3 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ display: 'flex', gap: '2px', color }}>
      {[1,2,3,4,5].map(i => (
        <Icon.Star key={i} filled={i <= rating} />
      ))}
    </div>
  );
}

// ── Pick Card ─────────────────────────────────────────────────────────────────
function PickCard({ pick, isSelected, onToggle, index }) {
  const [expanded, setExpanded] = useState(false);
  const ratingColor = pick.rating >= 4 ? '#4ade80' : pick.rating >= 3 ? '#fbbf24' : '#f87171';
  const ratingBg = pick.rating >= 4 ? 'rgba(74,222,128,0.08)' : pick.rating >= 3 ? 'rgba(251,191,36,0.08)' : 'rgba(248,113,113,0.08)';

  return (
    <div style={{
      background: isSelected ? 'rgba(74,222,128,0.06)' : 'var(--bg-secondary, #111)',
      border: `1px solid ${isSelected ? '#4ade80' : 'var(--border-color, #222)'}`,
      borderRadius: '12px',
      overflow: 'hidden',
      transition: 'all 0.2s',
      animation: `fadeUp 0.3s ease ${index * 0.06}s both`,
    }}>
      <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Header row */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Rating badge */}
        <div style={{
          background: ratingBg, border: `1px solid ${ratingColor}22`,
          borderRadius: '8px', padding: '6px 10px', flexShrink: 0, textAlign: 'center',
        }}>
          <div style={{ color: ratingColor, fontWeight: '800', fontSize: '18px', lineHeight: 1 }}>
            {pick.rating}
          </div>
          <StarRating rating={pick.rating} />
        </div>

        {/* Player info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--text-primary, #fff)' }}>
              {pick.player}
            </span>
            <span style={{
              fontSize: '10px', fontWeight: '700', padding: '2px 7px',
              background: 'rgba(99,102,241,0.15)', color: '#818cf8',
              borderRadius: '20px', letterSpacing: '0.5px',
            }}>
              {pick.team}
            </span>
          </div>
          <div style={{ marginTop: '3px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: '#60a5fa', fontWeight: '600' }}>
              {pick.direction} {pick.threshold != null ? pick.threshold : ''} {pick.stat}
              {pick.projection != null && (
                <span style={{ color: '#818cf8', fontWeight: '400', fontSize: '11px', marginLeft: '4px' }}>
                  (proj: {pick.projection})
                </span>
              )}
            </span>
            {pick.risk_flags?.length > 0 && (
              <span style={{ display:'flex', alignItems:'center', gap:'3px', fontSize:'11px', color:'#fbbf24' }}>
                <Icon.Warning /> {pick.risk_flags.length} flag{pick.risk_flags.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              background: 'transparent', border: '1px solid var(--border-color, #333)',
              borderRadius: '6px', color: 'var(--text-secondary, #888)',
              padding: '6px 10px', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
            }}
          >
            {expanded ? 'Less' : 'More'}
          </button>
          <button
            onClick={onToggle}
            style={{
              background: isSelected ? '#4ade80' : 'transparent',
              border: `1px solid ${isSelected ? '#4ade80' : 'var(--border-color, #333)'}`,
              borderRadius: '6px', color: isSelected ? '#000' : 'var(--text-secondary, #888)',
              padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '11px', fontWeight: '700', transition: 'all 0.15s',
            }}
          >
            {isSelected ? <><Icon.Check /> Added</> : <><Icon.Plus /> Add</>}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          padding: '0 16px 14px', borderTop: '1px solid var(--border-color, #222)',
          marginTop: '0', paddingTop: '12px',
        }}>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary, #999)', lineHeight: '1.6', margin: '0 0 8px' }}>
            {pick.rationale}
          </p>
          <div style={{ fontSize: '11px', color: ratingColor, fontWeight: '600', marginBottom: '6px' }}>
            {pick.rating_reason}
          </div>
          {pick.risk_flags?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
              {pick.risk_flags.map((flag, i) => (
                <span key={i} style={{
                  fontSize: '11px', padding: '3px 8px',
                  background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                  borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                  <Icon.Warning /> {flag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}



// ── Daily Card ────────────────────────────────────────────────────────────────
function DailyCard({ legCount }) {
  const [state, setState] = useState('idle');
  const [picks, setPicks] = useState([]);
  const [selectedLegs, setSelectedLegs] = useState([]);
  const [copied, setCopied] = useState(false);


  const load = async () => {
    setState('loading');
    setPicks([]);
    try {
      // Step 1: Get today's games
      const scanRes = await fetch('/api/pregame/scan?sport=nba');
      const scanData = await scanRes.json();
      if (!scanData.success || !scanData.games?.length) {
        setState('empty');
        return;
      }

      // Step 2: Analyze all games in parallel using daily mode (no Claude)
      const gameResults = await Promise.all(
        scanData.games.map(game =>
          fetch('/api/pregame/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              gameId:   game.id,
              sport:    game.sport,
              league:   game.league,
              homeTeam: game.homeTeam,
              awayTeam: game.awayTeam,
              gameDate: game.gameDate || game.startTime,
              mode:     'daily',
            }),
          })
          .then(r => r.json())
          .catch(() => null)
        )
      );

      // Step 3: Aggregate all picks, dedupe by player+stat, take top N
      const allPicks = [];
      const seen = new Set();
      for (const result of gameResults) {
        if (!result?.success || !result.picks?.length) continue;
        for (const pick of result.picks) {
          const key = `${pick.player}:${pick.stat}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allPicks.push(pick);
        }
      }

      // Sort by rating desc, edge desc — take top picks
      allPicks.sort((a, b) => b.rating !== a.rating ? b.rating - a.rating : b.edge - a.edge);
      setPicks(allPicks.slice(0, Math.max(legCount * 2, 10)));
      setState(allPicks.length > 0 ? 'done' : 'empty');
    } catch (err) {
      console.error('[DailyCard]', err);
      setState('error');
    }
  };

  const toggleLeg = (pick) => {
    const key = `${pick.player}:${pick.stat}`;
    setSelectedLegs(prev => {
      const exists = prev.find(l => l.key === key);
      return exists
        ? prev.filter(l => l.key !== key)
        : [...prev, { ...pick, key }];
    });
  };

  const copyParlay = () => {
    const text = selectedLegs.map(l =>
      `${l.player} Over ${l.threshold} ${l.stat} (${l.rating}★ | proj: ${l.projection})`
    ).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const ratingColor = (r) => r >= 4 ? '#4ade80' : r >= 3 ? '#fbbf24' : '#f87171';

  return (
    <div style={{ paddingBottom: selectedLegs.length > 0 ? '180px' : '24px' }}>



      {/* Load button */}
      {state === 'idle' && (
        <button onClick={load} style={{
          width: '100%', padding: '14px', borderRadius: '12px',
          background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
          border: 'none', color: '#fff', fontWeight: '700', fontSize: '15px',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          Load Today's Best Picks
        </button>
      )}

      {/* Loading */}
      {state === 'loading' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{
            width: '36px', height: '36px', margin: '0 auto 14px',
            border: '3px solid var(--border-color, #222)', borderTopColor: '#6366f1',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }}/>
          <p style={{ color: 'var(--text-secondary, #888)', fontSize: '13px', margin: 0 }}>
            Analyzing today's full slate...
          </p>
          <p style={{ color: 'var(--text-secondary, #555)', fontSize: '11px', marginTop: '6px' }}>
            This takes 15-20 seconds for all games
          </p>
        </div>
      )}

      {/* Empty */}
      {state === 'empty' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p style={{ color: 'var(--text-secondary, #888)', fontSize: '14px', marginBottom: '16px' }}>
            No strong picks found for today's slate.
          </p>
          <button onClick={load} style={{
            background: 'transparent', border: '1px solid var(--border-color, #333)',
            borderRadius: '8px', color: 'var(--text-secondary, #888)',
            padding: '8px 20px', cursor: 'pointer', fontSize: '13px',
          }}>Retry</button>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div style={{ textAlign: 'center', padding: '32px 24px' }}>
          <p style={{ color: '#f87171', fontSize: '13px', marginBottom: '12px' }}>Failed to load picks</p>
          <button onClick={load} style={{
            background: 'transparent', border: '1px solid #f87171',
            borderRadius: '8px', color: '#f87171',
            padding: '6px 16px', cursor: 'pointer', fontSize: '12px',
          }}>Retry</button>
        </div>
      )}

      {/* Picks */}
      {state === 'done' && picks.length > 0 && (
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', background: '#4ade80', borderRadius: '50%' }}/>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #888)', fontWeight: '600' }}>
                {picks.length} picks found across today's slate
              </span>
            </div>
            <button onClick={load} style={{
              background: 'transparent', border: '1px solid var(--border-color, #333)',
              borderRadius: '6px', color: 'var(--text-secondary, #888)',
              padding: '5px 10px', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <Icon.Refresh /> Refresh
            </button>
          </div>

          {picks.map((pick, i) => {
            const key = `${pick.player}:${pick.stat}`;
            const isSelected = selectedLegs.some(l => l.key === key);
            return (
              <div key={key} style={{
                background: isSelected ? 'rgba(74,222,128,0.06)' : 'var(--bg-secondary, #111)',
                border: `1px solid ${isSelected ? '#4ade80' : 'var(--border-color, #222)'}`,
                borderRadius: '12px', padding: '14px 16px', marginBottom: '10px',
                display: 'flex', alignItems: 'center', gap: '12px',
                animation: `fadeUp 0.25s ease ${i * 0.04}s both`,
              }}>
                <style>{`@keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }`}</style>

                {/* Rating */}
                <div style={{
                  width: '42px', height: '42px', borderRadius: '10px', flexShrink: 0,
                  background: `${ratingColor(pick.rating)}15`,
                  border: `1px solid ${ratingColor(pick.rating)}30`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: '17px', fontWeight: '800', color: ratingColor(pick.rating), lineHeight: 1 }}>
                    {pick.rating}
                  </span>
                  <span style={{ fontSize: '9px', color: ratingColor(pick.rating), opacity: 0.8 }}>★</span>
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary, #fff)' }}>
                      {pick.player}
                    </span>
                    <span style={{
                      fontSize: '10px', padding: '1px 6px', borderRadius: '10px',
                      background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontWeight: '700',
                    }}>{pick.team}</span>
                  </div>
                  <div style={{ marginTop: '2px', fontSize: '12px', color: '#60a5fa', fontWeight: '600' }}>
                    Over {pick.threshold} {pick.stat}
                    <span style={{ color: 'var(--text-secondary, #777)', fontWeight: '400', marginLeft: '6px' }}>
                      proj {pick.projection} · {pick.game}
                    </span>
                  </div>
                  <div style={{ marginTop: '3px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {pick.belowFloor && (
                      <span style={{ fontSize: '10px', color: '#4ade80', background: 'rgba(74,222,128,0.1)', padding: '1px 6px', borderRadius: '10px' }}>
                        below floor
                      </span>
                    )}
                    {pick.trend === 'up' && (
                      <span style={{ fontSize: '10px', color: '#60a5fa', background: 'rgba(96,165,250,0.1)', padding: '1px 6px', borderRadius: '10px' }}>
                        trending up
                      </span>
                    )}
                    {pick.isBackToBack && (
                      <span style={{ fontSize: '10px', color: '#fbbf24', background: 'rgba(251,191,36,0.1)', padding: '1px 6px', borderRadius: '10px' }}>
                        b2b
                      </span>
                    )}
                  </div>
                </div>

                {/* Add button */}
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <button
                    onClick={() => toggleLeg(pick)}
                    style={{
                      background: isSelected ? '#4ade80' : 'transparent',
                      border: `1px solid ${isSelected ? '#4ade80' : 'var(--border-color, #333)'}`,
                      borderRadius: '6px', color: isSelected ? '#000' : 'var(--text-secondary, #888)',
                      padding: '5px 10px', cursor: 'pointer',
                      fontSize: '11px', fontWeight: '700', transition: 'all 0.15s',
                    }}
                  >
                    {isSelected ? '✓' : '+'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Parlay builder */}
      {selectedLegs.length > 0 && (
        <div style={{
          position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
          width: 'min(420px, calc(100vw - 32px))',
          background: '#0f0f14', border: '1px solid #6366f133',
          borderRadius: '16px', padding: '16px', zIndex: 100,
          boxShadow: '0 -4px 40px rgba(99,102,241,0.2)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontWeight: '800', fontSize: '14px', color: '#fff' }}>
              Parlay ({selectedLegs.length} leg{selectedLegs.length !== 1 ? 's' : ''})
            </span>
          </div>
          {selectedLegs.map(leg => (
            <div key={leg.key} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'rgba(255,255,255,0.04)', borderRadius: '8px',
              padding: '7px 10px', marginBottom: '6px',
            }}>
              <span style={{ fontSize: '11px', color: ratingColor(leg.rating), fontWeight: '700', width: '16px' }}>
                {leg.rating}★
              </span>
              <span style={{ flex: 1, fontSize: '12px', color: '#e2e8f0', fontWeight: '600' }}>{leg.player}</span>
              <span style={{ fontSize: '11px', color: '#60a5fa' }}>Over {leg.threshold} {leg.stat}</span>
              <button onClick={() => toggleLeg(leg)} style={{
                background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '13px',
              }}>✕</button>
            </div>
          ))}
          <button onClick={copyParlay} style={{
            width: '100%', padding: '10px', borderRadius: '8px',
            background: copied ? '#4ade80' : 'linear-gradient(135deg, #6366f1, #3b82f6)',
            border: 'none', color: copied ? '#000' : '#fff',
            fontWeight: '700', fontSize: '13px', cursor: 'pointer',
            marginTop: '4px', transition: 'all 0.2s',
          }}>
            {copied ? '✓ Copied!' : 'Copy Parlay'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Performance Stats ─────────────────────────────────────────────────────────
function PerformanceStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  const load = async (d) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/halftime/stats?days=${d}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load stats');
      setStats(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, [days]);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{
        width: '32px', height: '32px', margin: '0 auto 12px',
        border: '2px solid var(--border-color, #222)', borderTopColor: '#6366f1',
        borderRadius: '50%', animation: 'spin 0.8s linear infinite',
      }}/>
      <p style={{ color: 'var(--text-secondary, #888)', fontSize: '13px', margin: 0 }}>
        Loading performance data...
      </p>
    </div>
  );

  if (error) return (
    <div style={{ textAlign: 'center', padding: '32px 24px' }}>
      <p style={{ color: '#f87171', fontSize: '13px', marginBottom: '12px' }}>{error}</p>
      <button onClick={() => load(days)} style={{
        background: 'transparent', border: '1px solid #f87171',
        borderRadius: '6px', color: '#f87171', padding: '6px 16px',
        cursor: 'pointer', fontSize: '12px',
      }}>Retry</button>
    </div>
  );

  if (!stats) return null;

  const { summary, by_rating, by_stat, by_direction, projection_accuracy, insights } = stats;

  // No data yet
  if (summary.graded === 0) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{
        width: '48px', height: '48px', margin: '0 auto 16px',
        background: 'rgba(99,102,241,0.1)', borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2">
          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
      </div>
      <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary, #fff)', fontWeight: '700' }}>
        No graded picks yet
      </h3>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary, #888)', lineHeight: '1.6' }}>
        Run some analyses and check back after the games finish. The cron job grades picks every 2 hours.
      </p>
      <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-secondary, #666)' }}>
        {summary.pending} pick{summary.pending !== 1 ? 's' : ''} pending grading
      </p>
    </div>
  );

  const hitRateColor = (rate) => {
    if (rate == null) return 'var(--text-secondary, #888)';
    if (rate >= 60) return '#4ade80';
    if (rate >= 50) return '#fbbf24';
    return '#f87171';
  };

  const starLabel = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  return (
    <div style={{ paddingBottom: '24px' }}>
      {/* Period selector */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
        {[7, 14, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} style={{
            padding: '5px 12px', borderRadius: '6px', border: 'none',
            background: days === d ? '#6366f1' : 'var(--bg-secondary, #111)',
            color: days === d ? '#fff' : 'var(--text-secondary, #888)',
            fontWeight: '600', fontSize: '12px', cursor: 'pointer',
            outline: days === d ? 'none' : '1px solid var(--border-color, #222)',
          }}>
            {d}d
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-secondary, #555)', alignSelf: 'center' }}>
          Last {days} days
        </span>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: 'Hit Rate', value: summary.hit_rate != null ? `${summary.hit_rate}%` : '—', color: hitRateColor(summary.hit_rate) },
          { label: 'Graded', value: summary.graded, color: 'var(--text-primary, #fff)' },
          { label: 'Pending', value: summary.pending, color: 'var(--text-secondary, #888)' },
        ].map(card => (
          <div key={card.label} style={{
            background: 'var(--bg-secondary, #111)',
            border: '1px solid var(--border-color, #222)',
            borderRadius: '10px', padding: '12px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '22px', fontWeight: '800', color: card.color }}>{card.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', marginTop: '4px', fontWeight: '600' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Recent streak */}
      {summary.recent_streak && (
        <div style={{
          background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: '10px', padding: '10px 14px', marginBottom: '20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary, #888)', fontWeight: '600' }}>Last 10 picks</span>
          <span style={{ fontSize: '14px', fontWeight: '800', color: '#818cf8' }}>{summary.recent_streak}</span>
        </div>
      )}

      {/* By star rating */}
      <div style={{
        background: 'var(--bg-secondary, #111)', border: '1px solid var(--border-color, #222)',
        borderRadius: '12px', padding: '16px', marginBottom: '14px',
      }}>
        <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary, #888)', marginBottom: '12px', letterSpacing: '0.5px' }}>
          HIT RATE BY STAR RATING
        </div>
        {[5,4,3,2,1].map(r => {
          const d = by_rating?.[r];
          if (!d || d.total === 0) return null;
          const pct = d.hitRate ?? 0;
          return (
            <div key={r} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', color: '#fbbf24', width: '60px', flexShrink: 0 }}>
                {starLabel(r)}
              </span>
              <div style={{ flex: 1, height: '6px', background: 'var(--border-color, #222)', borderRadius: '3px' }}>
                <div style={{ height: '6px', borderRadius: '3px', width: `${pct}%`, background: hitRateColor(pct), transition: 'width 0.4s ease' }}/>
              </div>
              <span style={{ fontSize: '13px', fontWeight: '700', color: hitRateColor(pct), width: '36px', textAlign: 'right' }}>
                {pct}%
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', width: '32px', textAlign: 'right' }}>
                {d.hits}/{d.total}
              </span>
            </div>
          );
        })}
      </div>

      {/* By stat */}
      <div style={{
        background: 'var(--bg-secondary, #111)', border: '1px solid var(--border-color, #222)',
        borderRadius: '12px', padding: '16px', marginBottom: '14px',
      }}>
        <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary, #888)', marginBottom: '12px', letterSpacing: '0.5px' }}>
          HIT RATE BY STAT
        </div>
        {Object.entries(by_stat || {}).sort((a,b) => (b[1].hitRate||0) - (a[1].hitRate||0)).map(([stat, d]) => {
          if (d.total === 0) return null;
          const pct = d.hitRate ?? 0;
          return (
            <div key={stat} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #888)', width: '72px', flexShrink: 0 }}>{stat}</span>
              <div style={{ flex: 1, height: '6px', background: 'var(--border-color, #222)', borderRadius: '3px' }}>
                <div style={{ height: '6px', borderRadius: '3px', width: `${pct}%`, background: hitRateColor(pct), transition: 'width 0.4s ease' }}/>
              </div>
              <span style={{ fontSize: '13px', fontWeight: '700', color: hitRateColor(pct), width: '36px', textAlign: 'right' }}>
                {pct}%
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', width: '32px', textAlign: 'right' }}>
                {d.hits}/{d.total}
              </span>
            </div>
          );
        })}
      </div>

      {/* Projection accuracy + insights */}
      {projection_accuracy?.picks_with_data > 0 && (
        <div style={{
          background: 'var(--bg-secondary, #111)', border: '1px solid var(--border-color, #222)',
          borderRadius: '12px', padding: '16px', marginBottom: '14px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary, #888)', marginBottom: '12px', letterSpacing: '0.5px' }}>
            PROJECTION ACCURACY
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {[
              { label: 'Avg Error', value: projection_accuracy.avg_absolute_error != null ? `±${projection_accuracy.avg_absolute_error}` : '—' },
              { label: 'Avg Error %', value: projection_accuracy.avg_error_pct != null ? `±${projection_accuracy.avg_error_pct}%` : '—' },
            ].map(item => (
              <div key={item.label} style={{
                background: 'var(--bg-primary, #000)', borderRadius: '8px', padding: '10px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary, #fff)' }}>{item.value}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', marginTop: '3px' }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights */}
      {(insights?.best_stat || insights?.worst_stat) && (
        <div style={{
          background: 'var(--bg-secondary, #111)', border: '1px solid var(--border-color, #222)',
          borderRadius: '12px', padding: '16px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary, #888)', marginBottom: '12px', letterSpacing: '0.5px' }}>
            INSIGHTS
          </div>
          {insights.best_stat && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary, #888)' }}>Strongest stat category</span>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#4ade80' }}>
                {insights.best_stat.stat} ({insights.best_stat.hitRate}%)
              </span>
            </div>
          )}
          {insights.worst_stat && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary, #888)' }}>Weakest stat category</span>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#f87171' }}>
                {insights.worst_stat.stat} ({insights.worst_stat.hitRate}%)
              </span>
            </div>
          )}
          {insights.best_rating && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary, #888)' }}>Most reliable rating tier</span>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#fbbf24' }}>
                {starLabel(parseInt(insights.best_rating))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Game Card ─────────────────────────────────────────────────────────────────
function GameCard({ game, selectedLegs, onToggleLeg, legCount, mode = 'halftime' }) {
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [analysis, setAnalysis] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [analysisMode, setAnalysisMode] = useState('picks'); // picks | pra

  const analyze = useCallback(async (existingLegs = []) => {
    setState('loading');
    setErrorMsg('');
    try {
      const endpoint = mode === 'halftime'
        ? '/api/halftime/analyze'
        : '/api/pregame/analyze';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: game.id,
          sport: game.sport,
          league: game.league,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          gameDate: game.gameDate || game.startTime,
          existingLegs,
          legCount,
          mode: analysisMode,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Analysis failed');
      setAnalysis(data);
      setState('done');
      // Auto-save all picks for outcome tracking (fire and forget)
      if (data.picks?.length > 0) {
        savePicks(data).catch(err => console.warn('[save-picks] failed silently:', err.message));
      }
    } catch (err) {
      setErrorMsg(err.message);
      setState('error');
    }
  }, [game, mode, analysisMode, legCount]);

  const savePicks = async (analysisData) => {
    // Use the projections returned directly from the API (keyed by player name)
    const projections = analysisData.projections || {};
    await fetch('/api/halftime/save-picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId:   game.id,
        sport:    game.sport,
        league:   game.league,
        gameName: game.shortName || game.name,
        gameDate: new Date().toISOString().split('T')[0],
        picks:    analysisData.picks,
        projections,
      }),
    });
  };

  const gameLegs = selectedLegs.filter(l => l.gameId === game.id);

  return (
    <div style={{
      background: 'var(--bg-secondary, #111)',
      border: '1px solid var(--border-color, #222)',
      borderRadius: '16px', overflow: 'hidden', marginBottom: '16px',
    }}>
      {/* Game header */}
      <div style={{
        padding: '16px 20px',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(59,130,246,0.05) 100%)',
        borderBottom: '1px solid var(--border-color, #222)',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}>
        <div style={{
          background: mode === 'halftime' ? '#ef4444' : '#6366f1',
          borderRadius: '6px', padding: '3px 8px',
          fontSize: '10px', fontWeight: '800', color: '#fff', letterSpacing: '1px',
          display: 'flex', alignItems: 'center', gap: '4px',
        }}>
          {mode === 'halftime' && (
            <span style={{ width: '6px', height: '6px', background: '#fff', borderRadius: '50%', animation: 'pulse 1.5s ease-in-out infinite', display: 'inline-block' }}/>
          )}
          {mode === 'halftime' ? 'HALFTIME' : 'PRE-GAME'}
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: '800', fontSize: '16px', color: 'var(--text-primary, #fff)' }}>
            {game.awayTeam.abbreviation} {game.awayTeam.score} – {game.homeTeam.score} {game.homeTeam.abbreviation}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary, #888)', marginTop: '2px' }}>
            {game.label} · {game.statusDescription}
            {game.startTime && (() => {
              const d = new Date(game.startTime);
              const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
              return <span style={{ marginLeft: '6px', color: 'var(--text-secondary, #888)' }}>· {date} {time}</span>;
            })()}
            {game.scoreDiff >= 20 && (
              <span style={{ color: '#fbbf24', marginLeft: '8px', fontWeight: '600' }}>
                ⚠️ Large lead
              </span>
            )}
          </div>
        </div>

        <span style={{
          fontSize: '10px', fontWeight: '700', padding: '3px 8px',
          background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderRadius: '20px',
        }}>
          {game.label}
        </span>
      </div>

      {/* Analyze button / loading / results */}
      <div style={{ padding: '16px 20px' }}>
        {/* Mode toggle — always visible in pregame mode */}
        {mode === 'pregame' && (
          <div style={{
            display: 'flex', gap: '6px', marginBottom: '10px',
            background: 'var(--bg-tertiary, #0a0a0a)',
            padding: '4px', borderRadius: '8px',
          }}>
            {[
              { id: 'picks', label: '🎯 Prop Picks' },
              { id: 'pra',   label: '📊 PRA Leader' },
            ].map(m => (
              <button
                key={m.id}
                onClick={() => { setAnalysisMode(m.id); setState('idle'); setAnalysis(null); }}
                style={{
                  flex: 1, padding: '7px', borderRadius: '6px', border: 'none',
                  background: analysisMode === m.id ? '#6366f1' : 'transparent',
                  color: analysisMode === m.id ? '#fff' : 'var(--text-secondary, #888)',
                  fontWeight: '600', fontSize: '12px', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {state === 'idle' && (
          <button
            onClick={() => analyze()}
            style={{
              width: '100%', padding: '12px', borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
              border: 'none', color: '#fff', fontWeight: '700', fontSize: '14px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            <Icon.Zap /> {analysisMode === 'pra' ? 'Find PRA Leader' : 'Analyze This Game'}
          </button>
        )}

        {state === 'loading' && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{
              width: '36px', height: '36px', margin: '0 auto 12px',
              border: '3px solid var(--border-color, #222)', borderTopColor: '#6366f1',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            }}/>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ color: 'var(--text-secondary, #888)', fontSize: '13px', margin: 0 }}>
              Pulling live box scores + player history...
            </p>
          </div>
        )}

        {state === 'error' && (
          <div style={{
            padding: '12px', borderRadius: '8px',
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#f87171', fontSize: '13px', textAlign: 'center',
          }}>
            {errorMsg}
            <button onClick={() => analyze()} style={{
              display: 'block', margin: '8px auto 0', background: 'transparent',
              border: '1px solid #f87171', borderRadius: '6px', color: '#f87171',
              padding: '4px 12px', cursor: 'pointer', fontSize: '12px',
            }}>Retry</button>
          </div>
        )}

        {state === 'done' && (
          <button
            onClick={() => analyze()}
            style={{
              width: '100%', padding: '9px', borderRadius: '8px', marginBottom: '12px',
              background: 'transparent',
              border: '1px solid var(--border-color, #333)',
              color: 'var(--text-secondary, #888)', fontWeight: '600', fontSize: '12px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            }}
          >
            <Icon.Refresh /> Re-analyze
          </button>
        )}

        {state === 'done' && analysis && analysis.mode === 'pra' && (
          <div>
            {/* PRA top pick */}
            <div style={{
              background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)',
              borderRadius: '12px', padding: '16px', marginBottom: '14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <div style={{
                  background: '#4ade80', color: '#000', borderRadius: '8px',
                  padding: '4px 10px', fontSize: '11px', fontWeight: '800',
                }}>TOP PRA PICK</div>
                <span style={{ fontSize: '16px', fontWeight: '800', color: 'var(--text-primary, #fff)' }}>
                  {analysis.top_pick}
                </span>
                <span style={{
                  fontSize: '10px', fontWeight: '700', padding: '2px 7px',
                  background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderRadius: '20px',
                }}>
                  {analysis.top_pick_team}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '16px', marginBottom: '10px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: '800', color: '#4ade80' }}>
                    {analysis.top_pick_pra_projection}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary, #888)', fontWeight: '600' }}>PRA PROJ</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
                    {[
                      { label: 'confidence', val: analysis.confidence?.toUpperCase(), color: analysis.confidence === 'high' ? '#4ade80' : analysis.confidence === 'medium' ? '#fbbf24' : '#f87171' },
                    ].map(b => (
                      <span key={b.label} style={{
                        fontSize: '10px', fontWeight: '700', padding: '2px 8px',
                        background: `${b.color}22`, color: b.color, borderRadius: '20px',
                      }}>{b.val}</span>
                    ))}
                    {'⭐'.repeat(analysis.confidence_rating || 0)}
                  </div>
                </div>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary, #999)', lineHeight: '1.6', margin: '0 0 8px' }}>
                {analysis.analysis}
              </p>
              {analysis.key_strengths?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
                  {analysis.key_strengths.map((s, i) => (
                    <span key={i} style={{
                      fontSize: '11px', padding: '3px 8px',
                      background: 'rgba(74,222,128,0.1)', color: '#4ade80', borderRadius: '20px',
                    }}>✓ {s}</span>
                  ))}
                </div>
              )}
              {analysis.risk_factors?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {analysis.risk_factors.map((r, i) => (
                    <span key={i} style={{
                      fontSize: '11px', padding: '3px 8px',
                      background: 'rgba(251,191,36,0.1)', color: '#fbbf24', borderRadius: '20px',
                    }}>⚠ {r}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Secondary pick */}
            {analysis.secondary_pick && (
              <div style={{
                background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)',
                borderRadius: '10px', padding: '12px', marginBottom: '14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: '700', color: '#818cf8' }}>SECONDARY</span>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary, #fff)' }}>
                    {analysis.secondary_pick}
                  </span>
                  <span style={{ fontSize: '10px', color: '#818cf8', padding: '2px 6px', background: 'rgba(99,102,241,0.15)', borderRadius: '20px' }}>
                    {analysis.secondary_pick_team}
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary, #999)', lineHeight: '1.5', margin: 0 }}>
                  {analysis.secondary_analysis}
                </p>
              </div>
            )}

            {/* Full rankings table */}
            {analysis.full_rankings?.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary, #888)', marginBottom: '8px', letterSpacing: '0.5px' }}>
                  ALL PLAYERS RANKED BY PRA
                </div>
                {analysis.full_rankings.map((p, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '8px 0',
                    borderBottom: i < analysis.full_rankings.length - 1 ? '1px solid var(--border-color, #1a1a1a)' : 'none',
                    opacity: p.lowSample ? 0.6 : 1,
                  }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary, #666)', width: '16px' }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary, #fff)', fontWeight: i === 0 ? '700' : '400' }}>
                        {p.player}
                      </span>
                      {p.lowSample && (
                        <span style={{ fontSize: '10px', color: '#fbbf24', marginLeft: '6px' }}>
                          ⚠ {p.sampleSize}g
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '10px', color: '#818cf8', padding: '1px 6px', background: 'rgba(99,102,241,0.1)', borderRadius: '10px' }}>
                      {p.team}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: i === 0 ? '#4ade80' : 'var(--text-primary, #fff)', minWidth: '36px', textAlign: 'right' }}>
                      {p.pra}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', minWidth: '80px', textAlign: 'right' }}>
                      {p.pts}/{p.reb}/{p.ast}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {state === 'done' && analysis && analysis.mode !== 'pra' && (
          <div>
            {/* Game summary */}
            <p style={{ fontSize: '13px', color: 'var(--text-secondary, #999)', lineHeight: '1.6', margin: '0 0 6px' }}>
              {analysis.game_summary}
            </p>
            {analysis.pace_note && (
              <p style={{ fontSize: '12px', color: '#60a5fa', margin: '0 0 14px', fontWeight: '600' }}>
                {analysis.pace_note}
              </p>
            )}

            {/* Pick cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
              {analysis.picks?.map((pick, i) => {
                const legKey = `${game.id}:${pick.player}:${pick.stat}`;
                const isSelected = selectedLegs.some(l => l.key === legKey);
                return (
                  <PickCard
                    key={legKey}
                    pick={pick}
                    index={i}
                    isSelected={isSelected}
                    onToggle={() => onToggleLeg({
                      key: legKey, gameId: game.id,
                      player: pick.player, team: pick.team,
                      stat: pick.stat, direction: pick.direction,
                      rating: pick.rating,
                    })}
                  />
                );
              })}
            </div>

            {/* More legs button */}
            <button
              onClick={() => analyze(gameLegs.map(l => ({ player: l.player, stat: l.stat })))}
              style={{
                width: '100%', padding: '10px', borderRadius: '8px',
                background: 'transparent', border: '1px solid var(--border-color, #333)',
                color: 'var(--text-secondary, #888)', fontWeight: '600', fontSize: '13px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}
            >
              <Icon.Refresh /> Get More Leg Options
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Parlay Builder sidebar ────────────────────────────────────────────────────
function ParlayBuilder({ legs, onRemove }) {
  const [copied, setCopied] = useState(false);

  const avgRating = legs.length
    ? Math.round((legs.reduce((s, l) => s + l.rating, 0) / legs.length) * 10) / 10
    : 0;

  const parlayText = legs.map(l => `${l.player} ${l.direction} ${l.stat} (${l.rating}⭐)`).join('\n');

  const copyParlay = () => {
    navigator.clipboard.writeText(parlayText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (legs.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
      width: 'min(420px, calc(100vw - 32px))',
      background: '#0f0f14', border: '1px solid #6366f133',
      borderRadius: '16px', padding: '16px', zIndex: 100,
      boxShadow: '0 -4px 40px rgba(99,102,241,0.2)',
      animation: 'slideUp 0.3s ease',
    }}>
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateX(-50%) translateY(20px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Icon.Clipboard />
          <span style={{ fontWeight: '800', fontSize: '14px', color: '#fff' }}>
            My Parlay ({legs.length} leg{legs.length !== 1 ? 's' : ''})
          </span>
        </div>
        <div style={{ fontSize: '12px', color: '#818cf8', fontWeight: '600' }}>
          Avg rating: {avgRating}★
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
        {legs.map(leg => (
          <div key={leg.key} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '8px 10px',
          }}>
            <StarRating rating={leg.rating} />
            <span style={{ flex: 1, fontSize: '13px', color: '#e2e8f0', fontWeight: '600' }}>
              {leg.player}
            </span>
            <span style={{ fontSize: '12px', color: '#60a5fa' }}>
              {leg.direction} {leg.stat}
            </span>
            <button onClick={() => onRemove(leg.key)} style={{
              background: 'transparent', border: 'none', color: '#555', cursor: 'pointer',
              padding: '2px 4px', fontSize: '14px', lineHeight: 1,
            }}>✕</button>
          </div>
        ))}
      </div>

      <button onClick={copyParlay} style={{
        width: '100%', padding: '10px', borderRadius: '8px',
        background: copied ? '#4ade80' : 'linear-gradient(135deg, #6366f1, #3b82f6)',
        border: 'none', color: copied ? '#000' : '#fff',
        fontWeight: '700', fontSize: '13px', cursor: 'pointer',
        transition: 'all 0.2s',
      }}>
        {copied ? '✓ Copied!' : 'Copy Parlay'}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Halftime() {
  const [mode, setMode] = useState('daily'); // daily | pregame | halftime | performance
  const [scanState, setScanState] = useState('idle');
  const [games, setGames] = useState([]);
  const [lastScanned, setLastScanned] = useState(null);
  const [selectedLegs, setSelectedLegs] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [legCount, setLegCount] = useState(4);

  const scan = useCallback(async () => {
    setScanState('scanning');
    setErrorMsg('');
    setGames([]);
    try {
      const url = mode === 'halftime'
        ? '/api/halftime/scan?sports=nba'
        : '/api/pregame/scan?sport=nba';
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Scan failed');
      setGames(data.games);
      setLastScanned(new Date());
      setScanState(data.games.length > 0 ? 'done' : 'empty');
    } catch (err) {
      setErrorMsg(err.message);
      setScanState('error');
    }
  }, [mode]);

  const switchMode = (newMode) => {
    setMode(newMode);
    setScanState('idle');
    setGames([]);
    setLastScanned(null);
    setErrorMsg('');
  };

  const toggleLeg = (leg) => {
    setSelectedLegs(prev => {
      const exists = prev.some(l => l.key === leg.key);
      return exists ? prev.filter(l => l.key !== leg.key) : [...prev, leg];
    });
  };

  const removeLeg = (key) => {
    setSelectedLegs(prev => prev.filter(l => l.key !== key));
  };

  return (
    <div style={{ paddingBottom: selectedLegs.length > 0 ? '180px' : '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: '800', color: 'var(--text-primary, #fff)' }}>
              {mode === 'daily' ? 'Daily Card' : mode === 'pregame' ? 'Pre-Game Picks' : mode === 'halftime' ? 'Halftime Picks' : 'Performance'}
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary, #888)', lineHeight: '1.5' }}>
              {mode === 'daily' ? "Top picks across today\'s full slate" : mode === 'pregame' ? 'Pre-game prop recommendations from historical projections' : mode === 'halftime' ? 'Live prop recommendations built from first-half data + recent form' : 'Pick accuracy and projection tracking over time'}
            </p>
          </div>
          {lastScanned && (
            <button
              onClick={scan}
              disabled={scanState === 'scanning'}
              style={{
                background: 'transparent', border: '1px solid var(--border-color, #333)',
                borderRadius: '8px', color: 'var(--text-secondary, #888)',
                padding: '8px 12px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '600',
                flexShrink: 0,
              }}
            >
              <Icon.Refresh /> Refresh
            </button>
          )}
        </div>

        {/* Mode toggle */}
        <div style={{
          marginTop: '14px', display: 'flex', gap: '8px',
          background: 'var(--bg-secondary, #111)',
          border: '1px solid var(--border-color, #222)',
          borderRadius: '10px', padding: '4px',
        }}>
          {[
            { id: 'daily',       label: 'Daily Card' },
            { id: 'pregame',     label: 'Pre-Game' },
            { id: 'halftime',    label: 'Halftime' },
            { id: 'performance', label: 'Performance' },
          ].map(m => (
            <button
              key={m.id}
              onClick={() => switchMode(m.id)}
              style={{
                flex: 1, padding: '9px 12px', borderRadius: '7px', border: 'none',
                background: mode === m.id ? '#6366f1' : 'transparent',
                color: mode === m.id ? '#fff' : 'var(--text-secondary, #888)',
                fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {lastScanned && (
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-tertiary, #555)' }}>
            Last scanned {lastScanned.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}

        {/* Leg count selector — hidden on Daily Card */}
        {mode !== 'daily' && <div style={{
          marginTop: '14px', display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px',
          background: 'var(--bg-secondary, #111)',
          border: '1px solid var(--border-color, #222)',
          borderRadius: '10px',
        }}>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary, #888)', whiteSpace: 'nowrap' }}>
            Legs per game
          </span>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[2, 3, 4, 5, 6, 7, 8].map(n => (
              <button
                key={n}
                onClick={() => setLegCount(n)}
                style={{
                  width: '34px', height: '34px', borderRadius: '8px',
                  border: `1px solid ${legCount === n ? '#6366f1' : 'var(--border-color, #333)'}`,
                  background: legCount === n ? '#6366f1' : 'transparent',
                  color: legCount === n ? '#fff' : 'var(--text-secondary, #888)',
                  fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>}
      </div>

      {/* Idle state */}
      {mode !== 'performance' && mode !== 'daily' && scanState === 'idle' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{
            width: '64px', height: '64px', margin: '0 auto 16px',
            background: 'rgba(99,102,241,0.1)', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#818cf8',
          }}>
            <Icon.Basketball />
          </div>
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary, #fff)', fontWeight: '700' }}>
            Ready to scan
          </h3>
          <p style={{ margin: '0 0 20px', color: 'var(--text-secondary, #888)', fontSize: '14px', lineHeight: '1.6' }}>
            {mode === 'halftime'
              ? 'Scan for NBA games currently at halftime. Works best during game windows.'
              : 'Load today\'s NBA games and get pre-game prop recommendations based on recent form and trends.'}
          </p>
          <button onClick={scan} style={{
            padding: '14px 32px', borderRadius: '12px',
            background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
            border: 'none', color: '#fff', fontWeight: '700', fontSize: '15px',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px',
          }}>
            <Icon.Zap /> {mode === 'halftime' ? 'Scan for Halftime Games' : 'Find Today\'s Games'}
          </button>
        </div>
      )}

      {/* Scanning */}
      {mode !== 'performance' && mode !== 'daily' && scanState === 'scanning' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{
            width: '40px', height: '40px', margin: '0 auto 16px',
            border: '3px solid var(--border-color, #222)', borderTopColor: '#6366f1',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }}/>
          <p style={{ color: 'var(--text-secondary, #888)', fontSize: '14px', margin: 0 }}>
            {mode === 'halftime' ? 'Scanning for halftime games...' : 'Loading today\'s games...'}
          </p>
        </div>
      )}

      {/* Error */}
      {mode !== 'performance' && mode !== 'daily' && scanState === 'error' && (
        <div style={{ textAlign: 'center', padding: '32px 24px' }}>
          <p style={{ color: '#f87171', marginBottom: '12px', fontSize: '14px' }}>{errorMsg}</p>
          <button onClick={scan} style={{
            padding: '10px 24px', borderRadius: '8px',
            background: 'transparent', border: '1px solid #f87171',
            color: '#f87171', cursor: 'pointer', fontWeight: '600',
          }}>
            Try Again
          </button>
        </div>
      )}

      {/* Empty */}
      {mode !== 'performance' && mode !== 'daily' && scanState === 'empty' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏁</div>
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary, #fff)', fontWeight: '700' }}>
            No halftime games right now
          </h3>
          <p style={{ margin: '0 0 20px', color: 'var(--text-secondary, #888)', fontSize: '14px' }}>
            {mode === 'halftime'
              ? 'Check back when NBA games are at halftime.'
              : 'No NBA games scheduled for today. Check back tomorrow.'}
          </p>
          <button onClick={scan} style={{
            padding: '10px 24px', borderRadius: '8px',
            background: 'transparent', border: '1px solid var(--border-color, #333)',
            color: 'var(--text-secondary, #888)', cursor: 'pointer',
            fontWeight: '600', fontSize: '13px',
            display: 'inline-flex', alignItems: 'center', gap: '6px',
          }}>
            <Icon.Refresh /> Scan Again
          </button>
        </div>
      )}

      {/* Games found */}
      {mode === 'performance' && <PerformanceStats />}
      {mode === 'daily' && <DailyCard legCount={legCount} />}

      {mode !== 'performance' && mode !== 'daily' && scanState === 'done' && games.length > 0 && (
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px',
            fontSize: '12px', color: 'var(--text-secondary, #888)', fontWeight: '600',
          }}>
            <div style={{ width: '8px', height: '8px', background: '#4ade80', borderRadius: '50%' }}/>
            {games.length} game{games.length !== 1 ? 's' : ''} {mode === 'halftime' ? 'at halftime' : 'today'}
          </div>

          {games.map(game => (
            <GameCard
              key={game.id}
              game={game}
              selectedLegs={selectedLegs}
              onToggleLeg={toggleLeg}
              legCount={legCount}
              mode={mode}
            />
          ))}
        </div>
      )}

      {/* Parlay builder */}
      <ParlayBuilder legs={selectedLegs} onRemove={removeLeg} />
    </div>
  );
}
