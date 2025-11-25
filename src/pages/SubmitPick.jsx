// FILE LOCATION: src/pages/SubmitPick.jsx
// REDESIGNED: DraftKings-inspired UI with game cards, category tabs, and player selections
import { useState, useEffect } from 'react';
import { db, auth } from '../firebase/config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import PickAnalysis from '../components/PickAnalysis';
import '../styles/SubmitPick.css';

// Icon Components (SVG)
const Icons = {
  ChevronRight: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor">
      <path d="M7 5l5 5-5 5" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  X: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor">
      <path d="M3 3l12 12M15 3L3 15" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  Plus: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor">
      <path d="M10 5v10M5 10h10" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  Check: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor">
      <path d="M4 10l4 4 8-8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  Clock: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <circle cx="8" cy="8" r="7" strokeWidth="1.5" />
      <path d="M8 4v4l3 2" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  ChevronDown: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor">
      <path d="M5 7l4 4 4-4" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
};

const STAT_CATEGORIES = {
  NFL: [
    { id: 'passing-yards', label: 'Passing Yards', group: 'passing' },
    { id: 'passing-tds', label: 'Pass TDs', group: 'passing' },
    { id: 'receiving-yards', label: 'Receiving Yards', group: 'receiving' },
    { id: 'receiving-tds', label: 'Rec TDs', group: 'receiving' },
    { id: 'rushing-yards', label: 'Rushing Yards', group: 'rushing' },
    { id: 'rushing-tds', label: 'Rush TDs', group: 'rushing' }
  ],
  NBA: [
    { id: 'points', label: 'Points', group: 'scoring' },
    { id: 'rebounds', label: 'Rebounds', group: 'rebounds' },
    { id: 'assists', label: 'Assists', group: 'assists' }
  ],
  NHL: [
    { id: 'goals', label: 'Goals', group: 'goals' },
    { id: 'assists', label: 'Assists', group: 'assists' },
    { id: 'shots', label: 'Shots', group: 'shots' }
  ]
};

export default function SubmitPick() {
  const [sport, setSport] = useState('NFL');
  const [games, setGames] = useState([]);
  const [selectedGameIndex, setSelectedGameIndex] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState('passing-yards');
  const [wager, setWager] = useState('2.00');
  const [legs, setLegs] = useState([]);
  const [reasoning, setReasoning] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [gameLoading, setGameLoading] = useState(false);

  useEffect(() => {
    fetchGames();
  }, [sport]);

  const fetchGames = async () => {
    setGameLoading(true);
    setSelectedGameIndex(0);
    setLegs([]);
    try {
      const response = await fetch(`/api/espn/get-games?sport=${sport}`);
      const data = await response.json();
      if (data.success && data.games.length > 0) {
        setGames(data.games);
      } else {
        setGames([]);
      }
    } catch (err) {
      console.error('Error fetching games:', err);
      setGames([]);
    } finally {
      setGameLoading(false);
    }
  };

  const currentGame = games[selectedGameIndex];
  const categories = STAT_CATEGORIES[sport] || [];
  const currentCategory = categories.find(c => c.id === selectedCategory);

  const addLeg = (player, threshold) => {
    if (!currentGame) return;
    
    const newLeg = {
      id: `${Date.now()}`,
      player,
      statCategory: selectedCategory,
      statLabel: currentCategory?.label,
      threshold,
      confidence: 'High',
      game: currentGame.name,
      gameId: currentGame.id
    };
    
    setLegs([...legs, newLeg]);
  };

  const removeLeg = (legId) => {
    setLegs(legs.filter(leg => leg.id !== legId));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (legs.length === 0) {
      setError('Please add at least one leg');
      return;
    }

    setError('');
    setLoading(true);
    setAnalysis(null);

    try {
      if (!auth.currentUser) {
        setError('You must be logged in');
        setLoading(false);
        return;
      }

      if (!currentGame) {
        setError('Please select a game');
        setLoading(false);
        return;
      }

      const pickData = {
        userId: auth.currentUser.uid,
        sport,
        game: currentGame.name,
        eventId: currentGame.eventId,
        wager: parseFloat(wager),
        originalLegs: legs,
        reasoning,
        submittedAt: serverTimestamp(),
        status: 'pending_analysis',
        analysis: null,
        userDecision: 'pending',
        result: null
      };

      const docRef = await addDoc(
        collection(db, 'users', auth.currentUser.uid, 'submitted_picks'),
        pickData
      );
      const pickId = docRef.id;

      const analysisResponse = await fetch('/api/picks/analyze-pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickId,
          userId: auth.currentUser.uid,
          pickData
        })
      });

      const analysisData = await analysisResponse.json();

      if (!analysisData.success) {
        setError('Analysis failed: ' + (analysisData.error || 'Unknown error'));
        setLoading(false);
        return;
      }

      setAnalysis(analysisData.analysis);
      setSuccess(true);

      setTimeout(() => {
        setSport('NFL');
        setSelectedGameIndex(0);
        setWager('2.00');
        setLegs([]);
        setReasoning('');
        setSuccess(false);
      }, 3000);

    } catch (err) {
      console.error('Error:', err);
      setError(err.message || 'Failed to submit pick');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="submit-pick-container-v2">
      {/* Header */}
      <div className="sp-header">
        <div className="sp-header-content">
          <h1>Build Your Parlay</h1>
          <p>AI-powered pick analysis & refinement</p>
        </div>
      </div>

      {/* Sport Selector */}
      <div className="sp-sport-selector">
        {['NFL', 'NBA', 'NHL'].map(s => (
          <button
            key={s}
            className={`sport-btn ${sport === s ? 'active' : ''}`}
            onClick={() => setSport(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {gameLoading ? (
        <div className="sp-loading">Loading games...</div>
      ) : games.length === 0 ? (
        <div className="sp-empty">
          <p>No games available for {sport}</p>
          <p className="sp-empty-sub">Check back soon or select a different sport</p>
        </div>
      ) : (
        <>
          {/* Game Cards */}
          <div className="sp-games-section">
            <h2 className="sp-section-title">Select Game</h2>
            <div className="sp-games-scroll">
              {games.map((g, idx) => (
                <button
                  key={g.id}
                  className={`sp-game-card ${selectedGameIndex === idx ? 'active' : ''}`}
                  onClick={() => setSelectedGameIndex(idx)}
                >
                  <div className="game-card-content">
                    <div className="game-matchup">
                      <div className="team">{g.awayTeam}</div>
                      <div className="at">@</div>
                      <div className="team">{g.homeTeam}</div>
                    </div>
                    <div className="game-time">
                      <Icons.Clock />
                      <span>{new Date(g.startTime).toLocaleDateString()} {new Date(g.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {currentGame && (
            <>
              {/* Category Tabs */}
              <div className="sp-categories-section">
                <div className="sp-categories-scroll">
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      className={`sp-category-tab ${selectedCategory === cat.id ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(cat.id)}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Player Selection Area */}
              <div className="sp-players-section">
                <h2 className="sp-section-title">{currentCategory?.label}</h2>
                <div className="sp-players-grid">
                  {/* Mock players - in real app, fetch from API */}
                  <div className="sp-player-card">
                    <div className="player-header">
                      <div className="player-avatar">JG</div>
                      <div className="player-info">
                        <div className="player-name">Player 1</div>
                        <div className="player-season">Avg: --</div>
                      </div>
                    </div>
                    <div className="player-thresholds">
                      {['50+', '75+', '100+'].map(t => (
                        <button
                          key={t}
                          className="threshold-btn"
                          onClick={() => addLeg('Player 1', t)}
                        >
                          {t}
                          <span className="odds">-110</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="sp-player-card">
                    <div className="player-header">
                      <div className="player-avatar">P2</div>
                      <div className="player-info">
                        <div className="player-name">Player 2</div>
                        <div className="player-season">Avg: --</div>
                      </div>
                    </div>
                    <div className="player-thresholds">
                      {['50+', '75+', '100+'].map(t => (
                        <button
                          key={t}
                          className="threshold-btn"
                          onClick={() => addLeg('Player 2', t)}
                        >
                          {t}
                          <span className="odds">-110</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="sp-player-card">
                    <div className="player-header">
                      <div className="player-avatar">P3</div>
                      <div className="player-info">
                        <div className="player-name">Player 3</div>
                        <div className="player-season">Avg: --</div>
                      </div>
                    </div>
                    <div className="player-thresholds">
                      {['50+', '75+', '100+'].map(t => (
                        <button
                          key={t}
                          className="threshold-btn"
                          onClick={() => addLeg('Player 3', t)}
                        >
                          {t}
                          <span className="odds">-110</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Parlay Summary */}
              {legs.length > 0 && (
                <div className="sp-summary-section">
                  <h2 className="sp-section-title">Parlay ({legs.length})</h2>
                  
                  <div className="sp-wager-input">
                    <label>Wager</label>
                    <div className="input-group">
                      <span className="currency">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.50"
                        value={wager}
                        onChange={(e) => setWager(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="sp-legs-list">
                    {legs.map((leg, idx) => (
                      <div key={leg.id} className="sp-leg-item">
                        <div className="leg-number">{idx + 1}</div>
                        <div className="leg-details">
                          <div className="leg-stat">{leg.statLabel}</div>
                          <div className="leg-player">{leg.player} {leg.threshold}</div>
                        </div>
                        <button
                          className="leg-remove"
                          onClick={() => removeLeg(leg.id)}
                          title="Remove leg"
                        >
                          <Icons.X />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="sp-reasoning">
                    <label>Why do you like these picks?</label>
                    <textarea
                      placeholder="Share your reasoning and edge..."
                      value={reasoning}
                      onChange={(e) => setReasoning(e.target.value)}
                      rows="3"
                    />
                  </div>

                  {error && <div className="sp-error">{error}</div>}
                  {success && <div className="sp-success">✓ Pick submitted and analyzed!</div>}

                  <button
                    type="submit"
                    disabled={loading || legs.length === 0}
                    className="sp-submit-btn"
                    onClick={handleSubmit}
                  >
                    {loading ? 'Analyzing...' : `Submit for Analysis`}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Analysis Results */}
      {analysis && <PickAnalysis analysis={analysis} />}
    </div>
  );
}
