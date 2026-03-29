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
  Baseball: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10"/>
      <path d="M5 12c2-2 4-3 7-3s5 1 7 3"/>
      <path d="M5 12c2 2 4 3 7 3s5-1 7-3"/>
    </svg>
  ),
  BaseballLg: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10"/>
      <path d="M5 12c2-2 4-3 7-3s5 1 7 3"/>
      <path d="M5 12c2 2 4 3 7 3s5-1 7-3"/>
    </svg>
  ),
  Hockey: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="12" cy="19" rx="8" ry="2.5"/>
      <path d="M6 19V9l6-6 6 6v10"/>
      <path d="M9 19v-6l3-3 3 3v6"/>
    </svg>
  ),
  HockeySmall: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="12" cy="19" rx="8" ry="2.5"/>
      <path d="M6 19V9l6-6 6 6v10"/>
      <path d="M9 19v-6l3-3 3 3v6"/>
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
  Target: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  BarChart: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  TrendUp: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
  Lock: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
  Sun: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  ),
  Moon: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  ),
  LogOut: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  Clock: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  Activity: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  ChevronDown: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  ChevronUp: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="18 15 12 9 6 15"/>
    </svg>
  ),
};
// ── Star Rating ───────────────────────────────────────────────────────────────
function StarRating({ rating }) {
  const color = rating >= 4 ? '#4ade80' : rating >= 3 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ display: 'flex', gap: '2px', color }}>
      {[1,2,3,4,5].map(i => <Icon.Star key={i} filled={i <= rating} />)}
    </div>
  );
}

// ── Pick Card ─────────────────────────────────────────────────────────────────
function PickCard({ pick, isSelected, onToggle, index }) {
  const [expanded, setExpanded] = useState(false);
  const ratingColor = pick.rating >= 4 ? '#4ade80' : pick.rating >= 3 ? '#fbbf24' : '#f87171';
  const ratingBg    = pick.rating >= 4 ? 'rgba(74,222,128,0.08)' : pick.rating >= 3 ? 'rgba(251,191,36,0.08)' : 'rgba(248,113,113,0.08)';

  return (
    <div style={{ background: isSelected ? 'rgba(124,58,237,0.08)' : 'var(--bg-secondary, #111)', border: `1px solid ${isSelected ? '#7c3aed' : 'var(--border-color, #222)'}`, borderRadius: '16px', overflow: 'hidden', transition: 'all 0.2s', animation: `fadeUp 0.3s ease ${index * 0.06}s both` }}>
      <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ background: ratingBg, border: `1px solid ${ratingColor}22`, borderRadius: '12px', padding: '8px 10px', flexShrink: 0, textAlign: 'center', minWidth: '42px' }}>
          <div style={{ color: ratingColor, fontWeight: '500', fontSize: '18px', lineHeight: 1 }}>{pick.rating}</div>
          <StarRating rating={pick.rating} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: '500', fontSize: '15px', color: 'var(--text-primary, #fff)' }}>{pick.player}</span>
            <span style={{ fontSize: '10px', fontWeight: '500', padding: '2px 7px', background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', borderRadius: '20px', letterSpacing: '0.5px' }}>{pick.team}</span>
            {pick.sport === 'mlb' && <span style={{ fontSize: '10px', fontWeight: '500', padding: '2px 6px', background: 'rgba(251,146,60,0.15)', color: '#fb923c', borderRadius: '20px' }}>MLB</span>}
            {pick.sport === 'nhl' && <span style={{ fontSize: '10px', fontWeight: '500', padding: '2px 6px', background: 'rgba(29,78,216,0.2)', color: '#60a5fa', borderRadius: '20px' }}>NHL</span>}
          </div>
          <div style={{ marginTop: '3px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: '#60a5fa', fontWeight: '500' }}>
              {pick.direction} {pick.hasRealLine ? pick.realLine : (pick.threshold != null ? pick.threshold : '')} {pick.stat}
              {pick.hasRealLine && <span style={{ fontSize: '10px', fontWeight: '500', marginLeft: '5px', padding: '1px 5px', borderRadius: '6px', background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>{pick.book || 'live'}</span>}
              {pick.projection != null && <span style={{ color: '#818cf8', fontWeight: '400', fontSize: '11px', marginLeft: '4px' }}>(proj: {pick.projection}{pick.hasRealLine && pick.lineGap != null ? ` · edge ${pick.lineGap > 0 ? '+' : ''}${pick.lineGap}` : ''})</span>}
            </span>
            {pick.risk_flags?.length > 0 && (
              <span style={{ display:'flex', alignItems:'center', gap:'3px', fontSize:'11px', color:'#fbbf24' }}>
                <Icon.Warning /> {pick.risk_flags.length} flag{pick.risk_flags.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button onClick={() => setExpanded(e => !e)} style={{ background: 'transparent', border: '1px solid var(--border-color, #333)', borderRadius: '10px', color: 'var(--text-secondary, #888)', padding: '6px 10px', cursor: 'pointer', fontSize: '11px', fontWeight: '500' }}>
            {expanded ? 'Less' : 'More'}
          </button>
          <button onClick={onToggle} style={{ background: isSelected ? '#7c3aed' : 'transparent', border: `1px solid ${isSelected ? '#7c3aed' : 'var(--border-color, #333)'}`, borderRadius: '10px', color: isSelected ? '#fff' : 'var(--text-secondary, #888)', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '500', transition: 'all 0.15s' }}>
            {isSelected ? <><Icon.Check /> Added</> : <><Icon.Plus /> Add</>}
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border-color, #222)', paddingTop: '12px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary, #999)', lineHeight: '1.6', margin: '0 0 8px' }}>{pick.rationale}</p>
          <div style={{ fontSize: '11px', color: ratingColor, fontWeight: '500', marginBottom: '6px' }}>{pick.rating_reason}</div>
          {pick.risk_flags?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
              {pick.risk_flags.map((flag, i) => (
                <span key={i} style={{ fontSize: '11px', padding: '3px 8px', background: 'rgba(251,191,36,0.1)', color: '#fbbf24', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '4px' }}>
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
function DailyCard({ legCount, cache, onCacheUpdate, selectedLegs, onToggleLeg }) {
  const state    = cache?.state    || 'idle';
  const nbaPicks = cache?.nbaPicks || [];
  const mlbPicks = cache?.mlbPicks || [];
  const nhlPicks = cache?.nhlPicks || [];
  const [dailySport, setDailySport] = useState('nba');

  const setState    = (v) => onCacheUpdate(c => ({ ...c, state: v }));
  const setNbaPicks = (v) => onCacheUpdate(c => ({ ...c, nbaPicks: v }));
  const setMlbPicks = (v) => onCacheUpdate(c => ({ ...c, mlbPicks: v }));
  const setNhlPicks = (v) => onCacheUpdate(c => ({ ...c, nhlPicks: v }));

  const activePicks = dailySport === 'nba' ? nbaPicks : dailySport === 'mlb' ? mlbPicks : nhlPicks;
  const totalPicks  = nbaPicks.length + mlbPicks.length + nhlPicks.length;

  const load = async () => {
    setState('loading');
    setNbaPicks([]);
    setMlbPicks([]);
    setNhlPicks([]);
    try {
      const [nbaScan, mlbScan, nhlScan] = await Promise.all([
        fetch('/api/pregame/scan?sport=nba').then(r => r.json()).catch(() => null),
        fetch('/api/pregame/scan?sport=mlb').then(r => r.json()).catch(() => null),
        fetch('/api/pregame/scan?sport=nhl').then(r => r.json()).catch(() => null),
      ]);

      const nbaGames = nbaScan?.success ? nbaScan.games || [] : [];
      const mlbGames = mlbScan?.success ? mlbScan.games || [] : [];
      const nhlGames = nhlScan?.success ? nhlScan.games || [] : [];

      const [nbaResults, mlbResults, nhlResults] = await Promise.all([
        Promise.all(nbaGames.map(game =>
          fetch('/api/pregame/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              gameId: game.id, sport: game.sport, league: game.league,
              homeTeam: game.homeTeam, awayTeam: game.awayTeam,
              gameDate: game.gameDate || game.startTime,
              mode: 'daily', oddsMap: {},
            }),
          }).then(r => r.json()).catch(() => null)
        )),
        Promise.all(mlbGames.map(game =>
          fetch('/api/pregame/analyze-mlb', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              gameId: game.id, league: game.league,
              homeTeam: game.homeTeam, awayTeam: game.awayTeam,
              gameDate: game.gameDate || game.startTime,
              mode: 'daily',
            }),
          }).then(r => r.json()).catch(() => null)
        )),
        Promise.all(nhlGames.map(game =>
          fetch('/api/pregame/analyze-nhl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              gameId: game.id, league: game.league,
              homeTeam: game.homeTeam.abbreviation, awayTeam: game.awayTeam.abbreviation,
              gameDate: game.gameDate || game.startTime,
              mode: 'daily',
            }),
          }).then(r => r.json()).catch(() => null)
        )),
      ]);

      const collectPicks = (results, sport) => {
        const picks = [];
        const seen  = new Set();
        for (const result of results) {
          if (!result?.success || !result.picks?.length) continue;
          for (const pick of result.picks) {
            const key = `${pick.player}:${pick.stat}`;
            if (seen.has(key)) continue;
            seen.add(key);
            picks.push({ ...pick, sport });
          }
        }
        picks.sort((a, b) => b.rating !== a.rating ? b.rating - a.rating : (b.edge ?? 0) - (a.edge ?? 0));
        return picks.slice(0, Math.max(legCount * 2, 10));
      };

      const nba = collectPicks(nbaResults, 'nba');
      const mlb = collectPicks(mlbResults, 'mlb');
      const nhl = collectPicks(nhlResults, 'nhl');
      setNbaPicks(nba);
      setMlbPicks(mlb);
      setNhlPicks(nhl);
      setState(nba.length > 0 || mlb.length > 0 || nhl.length > 0 ? 'done' : 'empty');
    } catch (err) {
      console.error('[DailyCard]', err);
      setState('error');
    }
  };

  const ratingColor = (r) => r >= 4 ? '#4ade80' : r >= 3 ? '#fbbf24' : '#f87171';
  const topRating   = totalPicks ? Math.max(...[...nbaPicks, ...mlbPicks, ...nhlPicks].map(p => p.rating)) : 0;
  const avgRating   = totalPicks ? ([...nbaPicks, ...mlbPicks, ...nhlPicks].reduce((s, p) => s + p.rating, 0) / totalPicks).toFixed(1) : '0';

  const renderPickRow = (pick, i) => {
    const key        = `${pick.player}:${pick.stat}`;
    const isSelected = selectedLegs.some(l => l.key === key);
    return (
      <div key={key} style={{ background: isSelected ? 'rgba(124,58,237,0.08)' : 'var(--bg-secondary, #111)', border: `1px solid ${isSelected ? '#7c3aed' : 'var(--border-color, #222)'}`, borderRadius: '16px', padding: '14px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '12px', animation: `fadeUp 0.25s ease ${i * 0.04}s both` }}>
        <div style={{ width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0, background: `${ratingColor(pick.rating)}15`, border: `1px solid ${ratingColor(pick.rating)}30`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '17px', fontWeight: '500', color: ratingColor(pick.rating), lineHeight: 1 }}>{pick.rating}</span>
          <span style={{ fontSize: '9px', color: ratingColor(pick.rating), opacity: 0.8 }}>★</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary, #fff)' }}>{pick.player}</span>
            <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', fontWeight: '500' }}>{pick.team}</span>
          </div>
          <div style={{ marginTop: '2px', fontSize: '12px', color: '#60a5fa', fontWeight: '500' }}>
            Over {pick.hasRealLine ? pick.realLine : pick.threshold} {pick.stat}
            {pick.hasRealLine && <span style={{ fontSize: '10px', fontWeight: '500', marginLeft: '5px', padding: '1px 5px', borderRadius: '6px', background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>{pick.book || 'live'}</span>}
            <span style={{ color: 'var(--text-secondary, #777)', fontWeight: '400', marginLeft: '6px' }}>proj {pick.projection}</span>
          </div>
          <div style={{ marginTop: '3px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {pick.belowFloor && <span style={{ fontSize: '10px', color: '#4ade80', background: 'rgba(74,222,128,0.1)', padding: '1px 6px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Icon.Lock /> below floor</span>}
            {pick.trend === 'up' && <span style={{ fontSize: '10px', color: '#60a5fa', background: 'rgba(96,165,250,0.1)', padding: '1px 6px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Icon.TrendUp /> trending up</span>}
            {pick.isBackToBack && <span style={{ fontSize: '10px', color: '#fbbf24', background: 'rgba(251,191,36,0.1)', padding: '1px 6px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Icon.Warning /> b2b</span>}
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <button onClick={() => onToggleLeg({ ...pick, key })} style={{ background: isSelected ? '#7c3aed' : 'transparent', border: `1px solid ${isSelected ? '#7c3aed' : 'var(--border-color, #333)'}`, borderRadius: '10px', color: isSelected ? '#fff' : 'var(--text-secondary, #888)', padding: '6px 12px', cursor: 'pointer', fontSize: '11px', fontWeight: '500', transition: 'all 0.15s' }}>
            {isSelected ? '✓' : '+ Add'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      {state === 'idle' && (
        <button onClick={load} style={{ width: '100%', padding: '15px', borderRadius: '14px', background: '#7c3aed', border: 'none', color: '#fff', fontWeight: '500', fontSize: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Icon.Zap /> Load Today's Best Picks
        </button>
      )}

      {state === 'loading' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ width: '36px', height: '36px', margin: '0 auto 14px', border: '3px solid var(--border-color, #222)', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: 'var(--text-secondary, #888)', fontSize: '13px', margin: 0 }}>Analyzing today's full slate — NBA + MLB + NHL...</p>
          <p style={{ color: 'var(--text-secondary, #555)', fontSize: '11px', marginTop: '6px' }}>This takes 20–30 seconds for all games</p>
        </div>
      )}

      {state === 'empty' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p style={{ color: 'var(--text-secondary, #888)', fontSize: '14px', marginBottom: '16px' }}>No strong picks found for today's slate.</p>
          <button onClick={load} style={{ background: 'transparent', border: '1px solid var(--border-color, #333)', borderRadius: '10px', color: 'var(--text-secondary, #888)', padding: '8px 20px', cursor: 'pointer', fontSize: '13px' }}>Retry</button>
        </div>
      )}

      {state === 'error' && (
        <div style={{ textAlign: 'center', padding: '32px 24px' }}>
          <p style={{ color: '#f87171', fontSize: '13px', marginBottom: '12px' }}>Failed to load picks</p>
          <button onClick={load} style={{ background: 'transparent', border: '1px solid #f87171', borderRadius: '10px', color: '#f87171', padding: '6px 16px', cursor: 'pointer', fontSize: '12px' }}>Retry</button>
        </div>
      )}

      {state === 'done' && (
        <div>
          {/* Summary card */}
          <div style={{ background: 'linear-gradient(135deg, #4c1d95, #5b21b6)', borderRadius: '16px', padding: '16px 18px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
              <div style={{ width: '7px', height: '7px', background: '#4ade80', borderRadius: '50%' }}/>
              <span style={{ fontSize: '12px', color: '#c4b5fd', fontWeight: '500' }}>{totalPicks} picks today</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div><p style={{ fontSize: '11px', color: '#c4b5fd', margin: '0 0 2px' }}>Picks</p><p style={{ fontSize: '22px', fontWeight: '500', color: '#fff', margin: 0 }}>{totalPicks}</p></div>
              <div><p style={{ fontSize: '11px', color: '#c4b5fd', margin: '0 0 2px' }}>Top rating</p><p style={{ fontSize: '22px', fontWeight: '500', color: '#fff', margin: 0 }}>{topRating} ★</p></div>
              <div><p style={{ fontSize: '11px', color: '#c4b5fd', margin: '0 0 2px' }}>Avg rating</p><p style={{ fontSize: '22px', fontWeight: '500', color: '#fff', margin: 0 }}>{avgRating} ★</p></div>
            </div>
          </div>

          {/* Sport selector — NBA / MLB / NHL tabs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {[
              { id: 'nba', label: 'NBA', icon: <Icon.Basketball />, count: nbaPicks.length },
              { id: 'mlb', label: 'MLB', icon: <Icon.Baseball />,   count: mlbPicks.length },
              { id: 'nhl', label: 'NHL', icon: <Icon.Hockey />,     count: nhlPicks.length },
            ].map(s => (
              <button
                key={s.id}
                onClick={() => setDailySport(s.id)}
                style={{ padding: '10px', borderRadius: '12px', border: `1px solid ${dailySport === s.id ? '#7c3aed' : 'var(--border-color, #222)'}`, background: dailySport === s.id ? 'rgba(124,58,237,0.15)' : 'var(--bg-secondary, #111)', color: dailySport === s.id ? '#a78bfa' : 'var(--text-secondary, #888)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: '500', fontSize: '13px', transition: 'all 0.15s' }}
              >
                {s.icon} {s.label}
                <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '10px', background: dailySport === s.id ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.06)', color: dailySport === s.id ? '#c4b5fd' : 'var(--text-secondary, #666)' }}>
                  {s.count}
                </span>
              </button>
            ))}
          </div>

          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary, #888)', fontWeight: '500' }}>
              {activePicks.length} pick{activePicks.length !== 1 ? 's' : ''}
            </span>
            <button onClick={load} style={{ background: 'transparent', border: '1px solid var(--border-color, #333)', borderRadius: '8px', color: 'var(--text-secondary, #888)', padding: '5px 10px', cursor: 'pointer', fontSize: '11px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Icon.Refresh /> Refresh
            </button>
          </div>

          {activePicks.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 24px' }}>
              <p style={{ color: 'var(--text-secondary, #888)', fontSize: '13px' }}>
                No {dailySport.toUpperCase()} picks available today.
              </p>
            </div>
          )}

          {activePicks.map((pick, i) => renderPickRow(pick, i))}
        </div>
      )}
    </div>
  );
}
// ── Performance Stats ─────────────────────────────────────────────────────────
function PerformanceStats() {
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [days, setDays]       = useState(30);

  const load = async (d) => {
    setLoading(true); setError('');
    try {
      const res  = await fetch(`/api/halftime/stats?days=${d}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load stats');
      setStats(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(days); }, [days]);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ width: '32px', height: '32px', margin: '0 auto 12px', border: '2px solid var(--border-color, #222)', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
      <p style={{ color: 'var(--text-secondary, #888)', fontSize: '13px', margin: 0 }}>Loading performance data...</p>
    </div>
  );
  if (error) return (
    <div style={{ textAlign: 'center', padding: '32px 24px' }}>
      <p style={{ color: '#f87171', fontSize: '13px', marginBottom: '12px' }}>{error}</p>
      <button onClick={() => load(days)} style={{ background: 'transparent', border: '1px solid #f87171', borderRadius: '10px', color: '#f87171', padding: '6px 16px', cursor: 'pointer', fontSize: '12px' }}>Retry</button>
    </div>
  );
  if (!stats) return null;

  const { summary, by_rating, by_stat, projection_accuracy, insights } = stats;

  if (summary.graded === 0) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ width: '48px', height: '48px', margin: '0 auto 16px', background: 'rgba(124,58,237,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a78bfa' }}><Icon.BarChart /></div>
      <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary, #fff)', fontWeight: '500' }}>No graded picks yet</h3>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary, #888)', lineHeight: '1.6' }}>Run some analyses and check back after the games finish. The cron job grades picks every 2 hours.</p>
      <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-secondary, #666)' }}>{summary.pending} pick{summary.pending !== 1 ? 's' : ''} pending grading</p>
    </div>
  );

  const hitRateColor = (rate) => { if (rate == null) return 'var(--text-secondary, #888)'; if (rate >= 60) return '#4ade80'; if (rate >= 50) return '#fbbf24'; return '#f87171'; };
  const starLabel    = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  return (
    <div style={{ paddingBottom: '24px' }}>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
        {[7, 14, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} style={{ padding: '6px 14px', borderRadius: '10px', border: 'none', background: days === d ? '#7c3aed' : 'var(--bg-secondary, #111)', color: days === d ? '#fff' : 'var(--text-secondary, #888)', fontWeight: '500', fontSize: '12px', cursor: 'pointer', outline: days === d ? 'none' : '1px solid var(--border-color, #222)' }}>{d}d</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-secondary, #555)', alignSelf: 'center' }}>Last {days} days</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: 'Hit Rate', value: summary.hit_rate != null ? `${summary.hit_rate}%` : '—', color: hitRateColor(summary.hit_rate) },
          { label: 'Graded',   value: summary.graded,  color: 'var(--text-primary, #fff)' },
          { label: 'Pending',  value: summary.pending, color: 'var(--text-secondary, #888)' },
        ].map(card => (
          <div key={card.label} style={{ background: 'var(--bg-secondary, #111)', border: '1px solid var(--border-color, #222)', borderRadius: '12px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: '500', color: card.color }}>{card.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', marginTop: '4px', fontWeight: '500' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {summary.recent_streak && (
        <div style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '12px', padding: '10px 14px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary, #888)', fontWeight: '500' }}>Last 10 picks</span>
          <span style={{ fontSize: '14px', fontWeight: '500', color: '#a78bfa' }}>{summary.recent_streak}</span>
        </div>
      )}

      <div style={{ background: 'var(--bg-secondary, #111)', border: '1px solid var(--border-color, #222)', borderRadius: '14px', padding: '16px', marginBottom: '14px' }}>
        <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-secondary, #888)', marginBottom: '12px', letterSpacing: '0.5px' }}>HIT RATE BY STAR RATING</div>
        {[5,4,3,2,1].map(r => {
          const d = by_rating?.[r]; if (!d || d.total === 0) return null;
          const pct = d.hitRate ?? 0;
          return (
            <div key={r} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', color: '#fbbf24', width: '60px', flexShrink: 0 }}>{starLabel(r)}</span>
              <div style={{ flex: 1, height: '6px', background: 'var(--border-color, #222)', borderRadius: '3px' }}><div style={{ height: '6px', borderRadius: '3px', width: `${pct}%`, background: hitRateColor(pct), transition: 'width 0.4s ease' }}/></div>
              <span style={{ fontSize: '13px', fontWeight: '500', color: hitRateColor(pct), width: '36px', textAlign: 'right' }}>{pct}%</span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', width: '32px', textAlign: 'right' }}>{d.hits}/{d.total}</span>
            </div>
          );
        })}
      </div>

      <div style={{ background: 'var(--bg-secondary, #111)', border: '1px solid var(--border-color, #222)', borderRadius: '14px', padding: '16px', marginBottom: '14px' }}>
        <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-secondary, #888)', marginBottom: '12px', letterSpacing: '0.5px' }}>HIT RATE BY STAT</div>
        {Object.entries(by_stat || {}).sort((a,b) => (b[1].hitRate||0) - (a[1].hitRate||0)).map(([stat, d]) => {
          if (d.total === 0) return null; const pct = d.hitRate ?? 0;
          return (
            <div key={stat} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #888)', width: '72px', flexShrink: 0 }}>{stat}</span>
              <div style={{ flex: 1, height: '6px', background: 'var(--border-color, #222)', borderRadius: '3px' }}><div style={{ height: '6px', borderRadius: '3px', width: `${pct}%`, background: hitRateColor(pct), transition: 'width 0.4s ease' }}/></div>
              <span style={{ fontSize: '13px', fontWeight: '500', color: hitRateColor(pct), width: '36px', textAlign: 'right' }}>{pct}%</span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', width: '32px', textAlign: 'right' }}>{d.hits}/{d.total}</span>
            </div>
          );
        })}
      </div>

      {projection_accuracy?.picks_with_data > 0 && (
        <div style={{ background: 'var(--bg-secondary, #111)', border: '1px solid var(--border-color, #222)', borderRadius: '14px', padding: '16px', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-secondary, #888)', marginBottom: '12px', letterSpacing: '0.5px' }}>PROJECTION ACCURACY</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {[
              { label: 'Avg Error',   value: projection_accuracy.avg_absolute_error != null ? `±${projection_accuracy.avg_absolute_error}` : '—' },
              { label: 'Avg Error %', value: projection_accuracy.avg_error_pct != null ? `±${projection_accuracy.avg_error_pct}%` : '—' },
            ].map(item => (
              <div key={item.label} style={{ background: 'var(--bg-primary, #000)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: '500', color: 'var(--text-primary, #fff)' }}>{item.value}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', marginTop: '3px' }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(insights?.best_stat || insights?.worst_stat) && (
        <div style={{ background: 'var(--bg-secondary, #111)', border: '1px solid var(--border-color, #222)', borderRadius: '14px', padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-secondary, #888)', marginBottom: '12px', letterSpacing: '0.5px' }}>INSIGHTS</div>
          {insights.best_stat  && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}><span style={{ fontSize: '13px', color: 'var(--text-secondary, #888)' }}>Strongest stat category</span><span style={{ fontSize: '13px', fontWeight: '500', color: '#4ade80' }}>{insights.best_stat.stat} ({insights.best_stat.hitRate}%)</span></div>}
          {insights.worst_stat && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}><span style={{ fontSize: '13px', color: 'var(--text-secondary, #888)' }}>Weakest stat category</span><span style={{ fontSize: '13px', fontWeight: '500', color: '#f87171' }}>{insights.worst_stat.stat} ({insights.worst_stat.hitRate}%)</span></div>}
          {insights.best_rating && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: '13px', color: 'var(--text-secondary, #888)' }}>Most reliable rating tier</span><span style={{ fontSize: '13px', fontWeight: '500', color: '#fbbf24' }}>{starLabel(parseInt(insights.best_rating))}</span></div>}
        </div>
      )}
    </div>
  );
}
// ── Game Card ─────────────────────────────────────────────────────────────────
function GameCard({ game, selectedLegs, onToggleLeg, legCount, mode = 'halftime', oddsMap = {}, cachedAnalysis, onAnalysisUpdate }) {
  const [state, setState]               = useState(cachedAnalysis ? 'done' : 'idle');
  const [analysis, setAnalysis]         = useState(cachedAnalysis || null);
  const [errorMsg, setErrorMsg]         = useState('');
  const [analysisMode, setAnalysisMode] = useState('picks');
  const [collapsed, setCollapsed]       = useState(false);

  const isMLB = game.league === 'mlb';
  const isNHL = game.league === 'nhl';

  const analyze = useCallback(async (existingLegs = []) => {
    setState('loading');
    setErrorMsg('');
    setCollapsed(false);
    try {
      let endpoint, body;
      if (mode === 'halftime') {
        endpoint = '/api/halftime/analyze';
        body = { gameId: game.id, sport: game.sport, league: game.league, homeTeam: game.homeTeam, awayTeam: game.awayTeam, gameDate: game.gameDate || game.startTime, existingLegs, legCount, mode: analysisMode, oddsMap };
      } else if (isMLB) {
        endpoint = '/api/pregame/analyze-mlb';
        body = { gameId: game.id, league: game.league, homeTeam: game.homeTeam, awayTeam: game.awayTeam, gameDate: game.gameDate || game.startTime, existingLegs, legCount };
      } else if (isNHL) {
        endpoint = '/api/pregame/analyze-nhl';
        body = { gameId: game.id, league: game.league, homeTeam: game.homeTeam.abbreviation, awayTeam: game.awayTeam.abbreviation,homeTeamId: game.homeTeam.id, awayTeamId: game.awayTeam.id, gameDate: game.gameDate || game.startTime, existingLegs, legCount };
      } else {
        endpoint = '/api/pregame/analyze';
        body = { gameId: game.id, sport: game.sport, league: game.league, homeTeam: game.homeTeam, awayTeam: game.awayTeam, gameDate: game.gameDate || game.startTime, existingLegs, legCount, mode: analysisMode, oddsMap };
      }

      const res  = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Analysis failed');
      setAnalysis(data);
      setState('done');
      if (onAnalysisUpdate) onAnalysisUpdate(game.id, data);
      if (data.picks?.length > 0) savePicks(data).catch(err => console.warn('[save-picks] failed silently:', err.message));
    } catch (err) {
      setErrorMsg(err.message);
      setState('error');
    }
  }, [game, mode, analysisMode, legCount, isMLB, isNHL]);

  const savePicks = async (analysisData) => {
    await fetch('/api/halftime/save-picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: game.id, sport: game.sport, league: game.league,
        gameName: game.shortName || game.name,
        gameDate: new Date().toISOString().split('T')[0],
        picks: analysisData.picks, projections: analysisData.projections || {},
      }),
    });
  };

  const gameLegs  = selectedLegs.filter(l => l.gameId === game.id);
  const modeLabel = mode === 'halftime' ? 'LIVE' : isMLB ? 'MLB' : isNHL ? 'NHL' : 'PRE-GAME';
  const modeBg    = mode === 'halftime' ? '#ef4444' : isMLB ? '#fb923c' : isNHL ? '#1d4ed8' : '#7c3aed';

  return (
    <div style={{ background: 'var(--bg-secondary, #111)', border: '1px solid var(--border-color, #222)', borderRadius: '16px', overflow: 'hidden', marginBottom: '16px' }}>
      <div onClick={state === 'done' ? () => setCollapsed(c => !c) : undefined} style={{ padding: '16px 20px', background: 'linear-gradient(135deg, rgba(124,58,237,0.1) 0%, rgba(59,130,246,0.05) 100%)', borderBottom: collapsed ? 'none' : '1px solid var(--border-color, #222)', display: 'flex', alignItems: 'center', gap: '12px', cursor: state === 'done' ? 'pointer' : 'default' }}>
        <div style={{ background: modeBg, borderRadius: '6px', padding: '3px 8px', fontSize: '10px', fontWeight: '500', color: '#fff', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          {mode === 'halftime' && <span style={{ width: '6px', height: '6px', background: '#fff', borderRadius: '50%', animation: 'pulse 1.5s ease-in-out infinite', display: 'inline-block' }}/>}
          {modeLabel}
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: '500', fontSize: '16px', color: 'var(--text-primary, #fff)' }}>
            {game.state === 'pre' ? (
              <>{game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}{game.startTime && <span style={{ fontSize: '13px', fontWeight: '400', color: '#a78bfa', marginLeft: '8px' }}>{new Date(game.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</span>}</>
            ) : (
              <>{game.awayTeam.abbreviation} {game.awayTeam.score} – {game.homeTeam.score} {game.homeTeam.abbreviation}</>
            )}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary, #888)', marginTop: '2px' }}>
            {game.label} · {game.statusDescription}
            {game.startTime && (() => { const d = new Date(game.startTime); return <span style={{ marginLeft: '6px' }}>· {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</span>; })()}
          </div>
          {state === 'done' && analysis?.picks?.length > 0 && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: '#a78bfa', fontWeight: '500' }}>
              {analysis.picks.length} pick{analysis.picks.length !== 1 ? 's' : ''} · tap to {collapsed ? 'expand' : 'collapse'}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', fontWeight: '500', padding: '3px 8px', background: 'rgba(124,58,237,0.15)', color: '#a78bfa', borderRadius: '20px' }}>{game.label}</span>
          {state === 'done' && <span style={{ color: '#a78bfa' }}>{collapsed ? <Icon.ChevronDown /> : <Icon.ChevronUp />}</span>}
        </div>
      </div>

      {!collapsed && (
        <div style={{ padding: '16px 20px' }}>
          {mode === 'pregame' && !isMLB && !isNHL && (
            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', background: 'var(--bg-tertiary, #0a0a0a)', padding: '4px', borderRadius: '10px' }}>
              {[{ id: 'picks', label: 'Prop Picks', icon: Icon.Target }, { id: 'pra', label: 'PRA Leader', icon: Icon.BarChart }].map(m => (
                <button key={m.id} onClick={() => { setAnalysisMode(m.id); setState('idle'); setAnalysis(null); if (onAnalysisUpdate) onAnalysisUpdate(game.id, null); }} style={{ flex: 1, padding: '7px', borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', background: analysisMode === m.id ? '#7c3aed' : 'transparent', color: analysisMode === m.id ? '#fff' : 'var(--text-secondary, #888)', fontWeight: '500', fontSize: '12px', cursor: 'pointer', transition: 'all 0.15s' }}>
                  <m.icon />{m.label}
                </button>
              ))}
            </div>
          )}

          {state === 'idle' && (
            <button onClick={() => analyze()} style={{ width: '100%', padding: '13px', borderRadius: '12px', background: '#7c3aed', border: 'none', color: '#fff', fontWeight: '500', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <Icon.Zap /> {analysisMode === 'pra' ? 'Find PRA Leader' : 'Analyze This Game'}
            </button>
          )}

          {state === 'loading' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ width: '36px', height: '36px', margin: '0 auto 12px', border: '3px solid var(--border-color, #222)', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
              <p style={{ color: 'var(--text-secondary, #888)', fontSize: '13px', margin: 0 }}>
                {mode === 'halftime' ? 'Pulling live box scores + player history...' : isMLB ? 'Pulling MLB gamelogs + pitcher data...' : isNHL ? 'Pulling NHL gamelogs + skater data...' : 'Pulling player history + projections...'}
              </p>
            </div>
          )}

          {state === 'error' && (
            <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: '13px', textAlign: 'center' }}>
              {errorMsg}
              <button onClick={() => analyze()} style={{ display: 'block', margin: '8px auto 0', background: 'transparent', border: '1px solid #f87171', borderRadius: '8px', color: '#f87171', padding: '4px 12px', cursor: 'pointer', fontSize: '12px' }}>Retry</button>
            </div>
          )}

          {state === 'done' && (
            <button onClick={() => analyze()} style={{ width: '100%', padding: '9px', borderRadius: '10px', marginBottom: '12px', background: 'transparent', border: '1px solid var(--border-color, #333)', color: 'var(--text-secondary, #888)', fontWeight: '500', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Icon.Refresh /> Re-analyze
            </button>
          )}

          {state === 'done' && analysis && analysis.mode === 'pra' && (
            <div>
              <div style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '14px', padding: '16px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <div style={{ background: '#4ade80', color: '#000', borderRadius: '8px', padding: '4px 10px', fontSize: '11px', fontWeight: '500' }}>TOP PRA PICK</div>
                  <span style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-primary, #fff)' }}>{analysis.top_pick}</span>
                  <span style={{ fontSize: '10px', fontWeight: '500', padding: '2px 7px', background: 'rgba(124,58,237,0.15)', color: '#a78bfa', borderRadius: '20px' }}>{analysis.top_pick_team}</span>
                </div>
                <div style={{ display: 'flex', gap: '16px', marginBottom: '10px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '22px', fontWeight: '500', color: '#4ade80' }}>{analysis.top_pick_pra_projection}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary, #888)', fontWeight: '500' }}>PRA PROJ</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
                      {[{ val: analysis.confidence?.toUpperCase(), color: analysis.confidence === 'high' ? '#4ade80' : analysis.confidence === 'medium' ? '#fbbf24' : '#f87171' }].map((b, i) => (
                        <span key={i} style={{ fontSize: '10px', fontWeight: '500', padding: '2px 8px', background: `${b.color}22`, color: b.color, borderRadius: '20px' }}>{b.val}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary, #999)', lineHeight: '1.6', margin: '0 0 8px' }}>{analysis.analysis}</p>
                {analysis.key_strengths?.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>{analysis.key_strengths.map((s, i) => <span key={i} style={{ fontSize: '11px', padding: '3px 8px', background: 'rgba(74,222,128,0.1)', color: '#4ade80', borderRadius: '20px' }}>✓ {s}</span>)}</div>}
                {analysis.risk_factors?.length > 0  && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{analysis.risk_factors.map((r, i) => <span key={i} style={{ fontSize: '11px', padding: '3px 8px', background: 'rgba(251,191,36,0.1)', color: '#fbbf24', borderRadius: '20px' }}>⚠ {r}</span>)}</div>}
              </div>
              {analysis.secondary_pick && (
                <div style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '12px', padding: '12px', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '10px', fontWeight: '500', color: '#a78bfa' }}>SECONDARY</span>
                    <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary, #fff)' }}>{analysis.secondary_pick}</span>
                    <span style={{ fontSize: '10px', color: '#a78bfa', padding: '2px 6px', background: 'rgba(124,58,237,0.15)', borderRadius: '20px' }}>{analysis.secondary_pick_team}</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary, #999)', lineHeight: '1.5', margin: 0 }}>{analysis.secondary_analysis}</p>
                </div>
              )}
              {analysis.full_rankings?.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '500', color: 'var(--text-secondary, #888)', marginBottom: '8px', letterSpacing: '0.5px' }}>ALL PLAYERS RANKED BY PRA</div>
                  {analysis.full_rankings.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: i < analysis.full_rankings.length - 1 ? '1px solid var(--border-color, #1a1a1a)' : 'none', opacity: p.lowSample ? 0.6 : 1 }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary, #666)', width: '16px' }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: '13px', color: 'var(--text-primary, #fff)', fontWeight: i === 0 ? '500' : '400' }}>{p.player}</span>{p.lowSample && <span style={{ fontSize: '10px', color: '#fbbf24', marginLeft: '6px' }}>⚠ {p.sampleSize}g</span>}</div>
                      <span style={{ fontSize: '10px', color: '#a78bfa', padding: '1px 6px', background: 'rgba(124,58,237,0.1)', borderRadius: '10px' }}>{p.team}</span>
                      <span style={{ fontSize: '13px', fontWeight: '500', color: i === 0 ? '#4ade80' : 'var(--text-primary, #fff)', minWidth: '36px', textAlign: 'right' }}>{p.pra}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', minWidth: '80px', textAlign: 'right' }}>{p.pts}/{p.reb}/{p.ast}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {state === 'done' && analysis && analysis.mode !== 'pra' && (
            <div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary, #999)', lineHeight: '1.6', margin: '0 0 6px' }}>{analysis.game_summary}</p>
              {analysis.pace_note && <p style={{ fontSize: '12px', color: '#60a5fa', margin: '0 0 14px', fontWeight: '500' }}>{analysis.pace_note}</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                {analysis.picks?.map((pick, i) => {
                  const legKey     = `${game.id}:${pick.player}:${pick.stat}`;
                  const isSelected = selectedLegs.some(l => l.key === legKey);
                  return (
                    <PickCard key={legKey} pick={pick} index={i} isSelected={isSelected} onToggle={() => onToggleLeg({ key: legKey, gameId: game.id, player: pick.player, team: pick.team, stat: pick.stat, direction: pick.direction, rating: pick.rating })} />
                  );
                })}
              </div>
              <button onClick={() => analyze(gameLegs.map(l => ({ player: l.player, stat: l.stat })))} style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'transparent', border: '1px solid var(--border-color, #333)', color: 'var(--text-secondary, #888)', fontWeight: '500', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <Icon.Refresh /> Get More Leg Options
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Parlay Builder ────────────────────────────────────────────────────────────
function ParlayBuilder({ legs, onRemove }) {
  const [copied, setCopied] = useState(false);
  const avgRating = legs.length ? Math.round((legs.reduce((s, l) => s + l.rating, 0) / legs.length) * 10) / 10 : 0;
  const copyParlay = () => {
    const text = legs.map(l => `${l.player} ${l.direction} ${l.stat} (${l.rating}⭐)`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  if (legs.length === 0) return null;
  return (
    <div style={{ position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)', width: 'min(420px, calc(100vw - 32px))', background: '#0f0f14', border: '1px solid rgba(124,58,237,0.3)', borderRadius: '16px', padding: '16px', zIndex: 100, boxShadow: '0 -4px 40px rgba(124,58,237,0.2)', animation: 'slideUp 0.3s ease' }}>
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateX(-50%) translateY(20px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Icon.Clipboard /><span style={{ fontWeight: '500', fontSize: '14px', color: '#fff' }}>My Parlay ({legs.length} leg{legs.length !== 1 ? 's' : ''})</span></div>
        <div style={{ fontSize: '12px', color: '#a78bfa', fontWeight: '500' }}>Avg {avgRating}★</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
        {legs.map(leg => (
          <div key={leg.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '8px 10px' }}>
            <StarRating rating={leg.rating} />
            <span style={{ flex: 1, fontSize: '13px', color: '#e2e8f0', fontWeight: '500' }}>{leg.player}</span>
            <span style={{ fontSize: '12px', color: '#60a5fa' }}>{leg.direction} {leg.stat}</span>
            <button onClick={() => onRemove(leg.key)} style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '2px 4px', fontSize: '14px', lineHeight: 1 }}>✕</button>
          </div>
        ))}
      </div>
      <button onClick={copyParlay} style={{ width: '100%', padding: '11px', borderRadius: '12px', background: copied ? '#4ade80' : '#7c3aed', border: 'none', color: copied ? '#000' : '#fff', fontWeight: '500', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s' }}>
        {copied ? '✓ Copied!' : 'Copy Parlay'}
      </button>
    </div>
  );
}
// ── Main page ─────────────────────────────────────────────────────────────────
export default function Halftime({ isDark, toggleTheme, onLogout }) {
  const [mode, setMode]                 = useState('daily');
  const [pregameSport, setPregameSport] = useState('nba');

  // ── Split scan state — NBA, MLB, and NHL persist independently ─────────────
  const [nbaGames, setNbaGames]             = useState([]);
  const [nbaScanState, setNbaScanState]     = useState('idle');
  const [nbaLastScanned, setNbaLastScanned] = useState(null);
  const [nbaOddsMap, setNbaOddsMap]         = useState({});

  const [mlbGames, setMlbGames]             = useState([]);
  const [mlbScanState, setMlbScanState]     = useState('idle');
  const [mlbLastScanned, setMlbLastScanned] = useState(null);

  const [nhlGames, setNhlGames]             = useState([]);
  const [nhlScanState, setNhlScanState]     = useState('idle');
  const [nhlLastScanned, setNhlLastScanned] = useState(null);

  // ── Live scan state ────────────────────────────────────────────────────────
  const [liveGames, setLiveGames]         = useState([]);
  const [liveScanState, setLiveScanState] = useState('idle');
  const [liveLastScanned, setLiveLast]    = useState(null);

  // ── Derived from active sport ──────────────────────────────────────────────
  const games       = mode === 'halftime' ? liveGames       : pregameSport === 'nba' ? nbaGames       : pregameSport === 'mlb' ? mlbGames       : nhlGames;
  const scanState   = mode === 'halftime' ? liveScanState   : pregameSport === 'nba' ? nbaScanState   : pregameSport === 'mlb' ? mlbScanState   : nhlScanState;
  const lastScanned = mode === 'halftime' ? liveLastScanned : pregameSport === 'nba' ? nbaLastScanned : pregameSport === 'mlb' ? mlbLastScanned : nhlLastScanned;
  const oddsMap     = pregameSport === 'nba' ? nbaOddsMap : {};

  const [selectedLegs, setSelectedLegs] = useState([]);
  const [errorMsg, setErrorMsg]         = useState('');
  const [legCount, setLegCount]         = useState(4);

  // ── Persistent caches ──────────────────────────────────────────────────────
  const [dailyCache, setDailyCache]     = useState({ state: 'idle', nbaPicks: [], mlbPicks: [], nhlPicks: [] });
  const [pregameCache, setPregameCache] = useState({});

  const updatePregameCache = useCallback((gameId, data) => {
    setPregameCache(prev => ({ ...prev, [gameId]: data }));
  }, []);

  const scan = useCallback(async () => {
    if (mode === 'halftime') {
      setLiveScanState('scanning');
      setErrorMsg('');
      setLiveGames([]);
      try {
        const res  = await fetch('/api/halftime/scan?sports=nba,mlb');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Scan failed');
        setLiveGames(data.games);
        setLiveLast(new Date());
        setLiveScanState(data.games.length > 0 ? 'done' : 'empty');
      } catch (err) {
        setErrorMsg(err.message);
        setLiveScanState('error');
      }
      return;
    }

    if (pregameSport === 'nba') {
      setNbaScanState('scanning');
      setErrorMsg('');
      setNbaGames([]);
      try {
        const res  = await fetch('/api/pregame/scan?sport=nba');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Scan failed');
        setNbaGames(data.games);
        setNbaOddsMap(data.oddsMap || {});
        setNbaLastScanned(new Date());
        setNbaScanState(data.games.length > 0 ? 'done' : 'empty');
      } catch (err) {
        setErrorMsg(err.message);
        setNbaScanState('error');
      }
    } else if (pregameSport === 'mlb') {
      setMlbScanState('scanning');
      setErrorMsg('');
      setMlbGames([]);
      try {
        const res  = await fetch('/api/pregame/scan?sport=mlb');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Scan failed');
        setMlbGames(data.games);
        setMlbLastScanned(new Date());
        setMlbScanState(data.games.length > 0 ? 'done' : 'empty');
      } catch (err) {
        setErrorMsg(err.message);
        setMlbScanState('error');
      }
    } else {
      setNhlScanState('scanning');
      setErrorMsg('');
      setNhlGames([]);
      try {
        const res  = await fetch('/api/pregame/scan?sport=nhl');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Scan failed');
        setNhlGames(data.games);
        setNhlLastScanned(new Date());
        setNhlScanState(data.games.length > 0 ? 'done' : 'empty');
      } catch (err) {
        setErrorMsg(err.message);
        setNhlScanState('error');
      }
    }
  }, [mode, pregameSport]);

  const switchMode = (newMode) => {
    setMode(newMode);
    setErrorMsg('');
    if (newMode === 'halftime') {
      setLiveScanState('idle');
      setLiveGames([]);
      setLiveLast(null);
    }
  };

  const switchPregameSport = (sport) => {
    setPregameSport(sport);
    setErrorMsg('');
    // No reset — each sport keeps its own scan state
  };

  const toggleLeg = (leg) => setSelectedLegs(prev =>
    prev.some(l => l.key === leg.key) ? prev.filter(l => l.key !== leg.key) : [...prev, leg]
  );
  const removeLeg = (key) => setSelectedLegs(prev => prev.filter(l => l.key !== key));

  const TABS = [
    { id: 'daily',       label: 'Daily',    icon: <Icon.Zap /> },
    { id: 'pregame',     label: 'Pre-Game', icon: <Icon.Clock /> },
    { id: 'halftime',    label: 'Live',     icon: <Icon.Activity /> },
    { id: 'performance', label: 'Stats',    icon: <Icon.BarChart /> },
  ];

  return (
    <div style={{ paddingBottom: selectedLegs.length > 0 ? '180px' : '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <Icon.Zap />
              <span style={{ fontSize: '12px', color: '#a78bfa', fontWeight: '500' }}>PaiGrade</span>
            </div>
            <h2 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: '500', color: 'var(--text-primary, #fff)' }}>
              {mode === 'daily' ? 'Daily Card' : mode === 'pregame' ? 'Pre-Game Picks' : mode === 'halftime' ? 'Live Picks' : 'Performance'}
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary, #888)', lineHeight: '1.5' }}>
              {mode === 'daily' ? "Top picks across today's full slate — NBA + MLB + NHL"
                : mode === 'pregame' ? 'Pre-game prop picks from historical projections'
                : mode === 'halftime' ? 'In-game prop picks built from live box scores + recent form'
                : 'Pick accuracy and projection tracking over time'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginTop: '2px' }}>
            {lastScanned && mode !== 'daily' && mode !== 'performance' && (
              <button onClick={scan} disabled={scanState === 'scanning'} style={{ background: 'transparent', border: '1px solid var(--border-color, #333)', borderRadius: '10px', color: 'var(--text-secondary, #888)', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '500' }}>
                <Icon.Refresh /> Refresh
              </button>
            )}
            {toggleTheme && (
              <button onClick={toggleTheme} style={{ background: 'transparent', border: '1px solid var(--border-color, #333)', borderRadius: '10px', color: 'var(--text-secondary, #888)', padding: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                {isDark ? <Icon.Sun /> : <Icon.Moon />}
              </button>
            )}
            {onLogout && (
              <button onClick={onLogout} style={{ background: 'transparent', border: '1px solid var(--border-color, #333)', borderRadius: '10px', color: 'var(--text-secondary, #888)', padding: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <Icon.LogOut />
              </button>
            )}
          </div>
        </div>

        {/* Tab tiles */}
        <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => switchMode(t.id)} style={{ background: mode === t.id ? '#7c3aed' : 'var(--bg-secondary, #1a1a2e)', border: `1px solid ${mode === t.id ? '#7c3aed' : 'var(--border-color, #2a2a3e)'}`, borderRadius: '12px', padding: '10px 6px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', transition: 'all 0.15s', color: mode === t.id ? '#fff' : '#888' }}>
              {t.icon}
              <span style={{ fontSize: '11px', fontWeight: '500' }}>{t.label}</span>
            </button>
          ))}
        </div>

        {lastScanned && mode !== 'daily' && mode !== 'performance' && (
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-tertiary, #555)' }}>
            Last scanned {lastScanned.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}

        {/* Pre-game sport selector */}
        {mode === 'pregame' && (
          <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            {[
              { id: 'nba', label: 'NBA', icon: <Icon.Basketball />, scanned: nbaLastScanned },
              { id: 'mlb', label: 'MLB', icon: <Icon.Baseball />,   scanned: mlbLastScanned },
              { id: 'nhl', label: 'NHL', icon: <Icon.Hockey />,     scanned: nhlLastScanned },
            ].map(s => (
              <button key={s.id} onClick={() => switchPregameSport(s.id)} style={{ padding: '10px', borderRadius: '12px', border: `1px solid ${pregameSport === s.id ? '#7c3aed' : 'var(--border-color, #222)'}`, background: pregameSport === s.id ? 'rgba(124,58,237,0.15)' : 'var(--bg-secondary, #111)', color: pregameSport === s.id ? '#a78bfa' : 'var(--text-secondary, #888)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: '500', fontSize: '13px', transition: 'all 0.15s' }}>
                {s.icon} {s.label}
                {s.scanned && <span style={{ fontSize: '10px', color: '#4ade80' }}>●</span>}
              </button>
            ))}
          </div>
        )}

        {/* Leg count slider */}
        {mode !== 'daily' && mode !== 'performance' && (
          <div style={{ marginTop: '14px', padding: '10px 14px', background: 'var(--bg-secondary, #111)', border: '1px solid var(--border-color, #222)', borderRadius: '12px' }}>
            <style>{`
              .leg-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 2px; outline: none; cursor: pointer; background: linear-gradient(to right, #7c3aed ${(legCount - 2) / 6 * 100}%, var(--border-color, #333) ${(legCount - 2) / 2 * 100}%); }
              .leg-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #7c3aed; border: 2px solid #fff; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
              .leg-slider::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #7c3aed; border: 2px solid #fff; cursor: pointer; }
            `}</style>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-secondary, #888)' }}>Legs per game</span>
              <span style={{ fontSize: '14px', fontWeight: '500', color: '#a78bfa' }}>{legCount}</span>
            </div>
            <input type="range" min={2} max={4} step={1} value={legCount} onChange={e => setLegCount(Number(e.target.value))} className="leg-slider" />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
              {[2,3,4].map(n => <span key={n} style={{ fontSize: '10px', color: n === legCount ? '#a78bfa' : 'var(--text-secondary, #555)', fontWeight: n === legCount ? '500' : '400' }}>{n}</span>)}
            </div>
          </div>
        )}
      </div>

      {/* Idle */}
      {mode !== 'performance' && mode !== 'daily' && scanState === 'idle' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ width: '64px', height: '64px', margin: '0 auto 16px', background: 'rgba(124,58,237,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a78bfa' }}>
            {pregameSport === 'mlb' ? <Icon.BaseballLg /> : pregameSport === 'nhl' ? <Icon.Hockey /> : <Icon.Basketball />}
          </div>
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary, #fff)', fontWeight: '500' }}>Ready to scan</h3>
          <p style={{ margin: '0 0 20px', color: 'var(--text-secondary, #888)', fontSize: '14px', lineHeight: '1.6' }}>
            {mode === 'halftime' ? 'Scan for games currently in progress.'
              : pregameSport === 'mlb' ? "Load today's MLB games and get prop recommendations."
              : pregameSport === 'nhl' ? "Load today's NHL games and get prop recommendations."
              : "Load today's NBA games and get pre-game prop recommendations."}
          </p>
          <button onClick={scan} style={{ padding: '14px 32px', borderRadius: '14px', background: '#7c3aed', border: 'none', color: '#fff', fontWeight: '500', fontSize: '15px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Icon.Zap />
            {mode === 'halftime' ? 'Scan for Live Games' : pregameSport === 'mlb' ? 'Find MLB Games' : pregameSport === 'nhl' ? 'Find NHL Games' : 'Find NBA Games'}
          </button>
        </div>
      )}

      {/* Scanning */}
      {mode !== 'performance' && mode !== 'daily' && scanState === 'scanning' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ width: '40px', height: '40px', margin: '0 auto 16px', border: '3px solid var(--border-color, #222)', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
          <p style={{ color: 'var(--text-secondary, #888)', fontSize: '14px', margin: 0 }}>
            {mode === 'halftime' ? 'Scanning for live games...' : pregameSport === 'mlb' ? 'Loading MLB games...' : pregameSport === 'nhl' ? 'Loading NHL games...' : 'Loading NBA games...'}
          </p>
        </div>
      )}

      {/* Error */}
      {mode !== 'performance' && mode !== 'daily' && scanState === 'error' && (
        <div style={{ textAlign: 'center', padding: '32px 24px' }}>
          <p style={{ color: '#f87171', marginBottom: '12px', fontSize: '14px' }}>{errorMsg}</p>
          <button onClick={scan} style={{ padding: '10px 24px', borderRadius: '10px', background: 'transparent', border: '1px solid #f87171', color: '#f87171', cursor: 'pointer', fontWeight: '500' }}>Try Again</button>
        </div>
      )}

      {/* Empty */}
      {mode !== 'performance' && mode !== 'daily' && scanState === 'empty' && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary, #fff)', fontWeight: '500' }}>No games right now</h3>
          <p style={{ margin: '0 0 20px', color: 'var(--text-secondary, #888)', fontSize: '14px' }}>
            {mode === 'halftime' ? 'Check back when games are in progress.'
              : pregameSport === 'mlb' ? 'No MLB games scheduled for today.'
              : pregameSport === 'nhl' ? 'No NHL games scheduled for today.'
              : 'No NBA games scheduled for today.'}
          </p>
          <button onClick={scan} style={{ padding: '10px 24px', borderRadius: '10px', background: 'transparent', border: '1px solid var(--border-color, #333)', color: 'var(--text-secondary, #888)', cursor: 'pointer', fontWeight: '500', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon.Refresh /> Scan Again
          </button>
        </div>
      )}

      {mode === 'performance' && <PerformanceStats />}

      {mode === 'daily' && (
        <DailyCard
          legCount={legCount}
          cache={dailyCache}
          onCacheUpdate={setDailyCache}
          selectedLegs={selectedLegs}
          onToggleLeg={toggleLeg}
        />
      )}

      {mode !== 'performance' && mode !== 'daily' && scanState === 'done' && games.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '12px', color: 'var(--text-secondary, #888)', fontWeight: '500' }}>
            <div style={{ width: '8px', height: '8px', background: '#4ade80', borderRadius: '50%' }}/>
            {games.length} game{games.length !== 1 ? 's' : ''} {mode === 'halftime' ? 'live' : 'today'}
          </div>
          {games.map(game => (
            <GameCard
              key={game.id}
              game={game}
              selectedLegs={selectedLegs}
              onToggleLeg={toggleLeg}
              legCount={legCount}
              mode={mode}
              oddsMap={oddsMap}
              cachedAnalysis={mode === 'pregame' ? pregameCache[game.id] : null}
              onAnalysisUpdate={mode === 'pregame' ? updatePregameCache : null}
            />
          ))}
        </div>
      )}

      <ParlayBuilder legs={selectedLegs} onRemove={removeLeg} />
    </div>
  );
}
