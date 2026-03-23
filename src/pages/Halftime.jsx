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
              {pick.direction} {pick.stat}
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

// ── Game Card ─────────────────────────────────────────────────────────────────
function GameCard({ game, selectedLegs, onToggleLeg, legCount }) {
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [analysis, setAnalysis] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const analyze = useCallback(async (existingLegs = []) => {
    setState('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/halftime/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: game.id,
          sport: game.sport,
          league: game.league,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          existingLegs,
          legCount,
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
  }, [game]);

  const savePicks = async (analysisData) => {
    // Build projection map keyed by player name for storage
    const projections = {};
    analysisData.picks?.forEach(pick => {
      // We don't have the raw projection object here — store what Claude used
      projections[pick.player] = {
        blended:    null, // projection math is in analyze.js, not returned to UI
        rationale:  pick.rationale,
      };
    });
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
          background: '#ef4444', borderRadius: '6px', padding: '3px 8px',
          fontSize: '10px', fontWeight: '800', color: '#fff', letterSpacing: '1px',
          display: 'flex', alignItems: 'center', gap: '4px',
        }}>
          <span style={{ width: '6px', height: '6px', background: '#fff', borderRadius: '50%', animation: 'pulse 1.5s ease-in-out infinite', display: 'inline-block' }}/>
          HALFTIME
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: '800', fontSize: '16px', color: 'var(--text-primary, #fff)' }}>
            {game.awayTeam.abbreviation} {game.awayTeam.score} – {game.homeTeam.score} {game.homeTeam.abbreviation}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary, #888)', marginTop: '2px' }}>
            {game.label} · {game.statusDescription}
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
            <Icon.Zap /> Analyze This Game
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

        {state === 'done' && analysis && (
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
  const [scanState, setScanState] = useState('idle'); // idle | scanning | done | empty | error
  const [games, setGames] = useState([]);
  const [lastScanned, setLastScanned] = useState(null);
  const [selectedLegs, setSelectedLegs] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [legCount, setLegCount] = useState(4);

  const scan = useCallback(async () => {
    setScanState('scanning');
    setErrorMsg('');
    try {
      const res = await fetch('/api/halftime/scan?sports=nba,nhl');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Scan failed');
      setGames(data.games);
      setLastScanned(new Date());
      setScanState(data.games.length > 0 ? 'done' : 'empty');
    } catch (err) {
      setErrorMsg(err.message);
      setScanState('error');
    }
  }, []);

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
              Halftime Picks
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary, #888)', lineHeight: '1.5' }}>
              Live prop recommendations built from first-half data + recent form
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

        {lastScanned && (
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-tertiary, #555)' }}>
            Last scanned {lastScanned.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}

        {/* Leg count selector */}
        <div style={{
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
        </div>
      </div>

      {/* Idle state */}
      {scanState === 'idle' && (
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
            Scan for NBA and NHL games currently at halftime.
            Works best when games are actually in progress.
          </p>
          <button onClick={scan} style={{
            padding: '14px 32px', borderRadius: '12px',
            background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
            border: 'none', color: '#fff', fontWeight: '700', fontSize: '15px',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px',
          }}>
            <Icon.Zap /> Scan for Halftime Games
          </button>
        </div>
      )}

      {/* Scanning */}
      {scanState === 'scanning' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{
            width: '40px', height: '40px', margin: '0 auto 16px',
            border: '3px solid var(--border-color, #222)', borderTopColor: '#6366f1',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }}/>
          <p style={{ color: 'var(--text-secondary, #888)', fontSize: '14px', margin: 0 }}>
            Scanning NBA &amp; NHL scoreboards...
          </p>
        </div>
      )}

      {/* Error */}
      {scanState === 'error' && (
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
      {scanState === 'empty' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏁</div>
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary, #fff)', fontWeight: '700' }}>
            No halftime games right now
          </h3>
          <p style={{ margin: '0 0 20px', color: 'var(--text-secondary, #888)', fontSize: '14px' }}>
            Check back when NBA or NHL games are in progress.
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
      {scanState === 'done' && games.length > 0 && (
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px',
            fontSize: '12px', color: 'var(--text-secondary, #888)', fontWeight: '600',
          }}>
            <div style={{ width: '8px', height: '8px', background: '#4ade80', borderRadius: '50%' }}/>
            {games.length} game{games.length !== 1 ? 's' : ''} at halftime
          </div>

          {games.map(game => (
            <GameCard
              key={game.id}
              game={game}
              selectedLegs={selectedLegs}
              onToggleLeg={toggleLeg}
              legCount={legCount}
            />
          ))}
        </div>
      )}

      {/* Parlay builder */}
      <ParlayBuilder legs={selectedLegs} onRemove={removeLeg} />
    </div>
  );
}
