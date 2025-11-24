// FILE LOCATION: src/pages/SubmitPick.jsx
import { useState, useEffect } from 'react';
import { db, auth } from '../firebase/config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import LegForm from '../components/LegForm';
import PickAnalysis from '../components/PickAnalysis';
import '../styles/SubmitPick.css';

export default function SubmitPick() {
  const [sport, setSport] = useState('NFL');
  const [games, setGames] = useState([]);
  const [game, setGame] = useState('');
  const [gameEventId, setGameEventId] = useState('');
  const [gameLoading, setGameLoading] = useState(false);
  const [wager, setWager] = useState('2.00');
  const [legs, setLegs] = useState([
    { player: '', stat: '', statCategory: '', confidence: 'High' }
  ]);
  const [reasoning, setReasoning] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    fetchGames();
  }, [sport]);

  const fetchGames = async () => {
    setGameLoading(true);
    setGame('');
    setGameEventId('');
    setAnalysis(null);
    try {
      const response = await fetch(`/api/espn/get-games?sport=${sport}`);
      const data = await response.json();
      
      if (data.success) {
        setGames(data.games);
      }
    } catch (err) {
      console.error('Error fetching games:', err);
      setError('Failed to load games');
    } finally {
      setGameLoading(false);
    }
  };

  const addLeg = () => {
    setLegs([...legs, { player: '', stat: '', statCategory: '', confidence: 'High' }]);
  };

  const removeLeg = (index) => {
    setLegs(legs.filter((_, i) => i !== index));
  };

  const updateLeg = (index, field, value) => {
    const newLegs = [...legs];
    newLegs[index][field] = value;
    setLegs(newLegs);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log('🔵 FORM SUBMITTED - handleSubmit called');
    setError('');
    setLoading(true);
    setAnalysis(null);

    try {
      console.log('✅ Starting validation...');
      
      if (!auth.currentUser) {
        console.error('❌ No user logged in');
        setError('You must be logged in');
        setLoading(false);
        return;
      }
      console.log('✅ User logged in:', auth.currentUser.uid);

      if (!game) {
        console.warn('⚠️ No game selected');
        setError('Please select a game');
        setLoading(false);
        return;
      }
      console.log('✅ Game selected:', game);

      const filledLegs = legs.filter(leg => leg.player && leg.statCategory && leg.threshold);
      console.log('✅ Filled legs count:', filledLegs.length);
      
      if (filledLegs.length === 0) {
        console.warn('⚠️ No legs filled');
        setError('Please add at least one leg');
        setLoading(false);
        return;
      }

      console.log('📝 All validation passed');
      console.log('📝 Creating pick data with', filledLegs.length, 'legs');
      
      const pickData = {
        userId: auth.currentUser.uid,
        sport,
        game,
        eventId: gameEventId,
        wager: parseFloat(wager),
        originalLegs: filledLegs,
        reasoning,
        submittedAt: serverTimestamp(),
        status: 'pending_analysis',
        analysis: null,
        userDecision: 'pending',
        result: null
      };

      console.log('💾 Saving to Firestore...');
      const docRef = await addDoc(
        collection(db, 'users', auth.currentUser.uid, 'submitted_picks'),
        pickData
      );
      const pickId = docRef.id;
      console.log('✅ Pick saved with ID:', pickId);

      console.log('🔍 Calling analysis endpoint...');
      const analysisResponse = await fetch('/api/picks/analyze-pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickId,
          userId: auth.currentUser.uid,
          pickData: {
            sport,
            game,
            eventId: gameEventId,
            wager: parseFloat(wager),
            originalLegs: filledLegs,
            reasoning
          }
        })
      });

      console.log('📊 Analysis response status:', analysisResponse.status);
      const analysisData = await analysisResponse.json();
      console.log('📊 Analysis data received:', analysisData);

      if (!analysisData.success) {
        console.error('❌ Analysis failed:', analysisData.error);
        setError('Analysis failed: ' + (analysisData.error || 'Unknown error'));
        setLoading(false);
        return;
      }

      console.log('✅ Analysis successful');
      setAnalysis(analysisData.analysis);
      setSuccess(true);

      setTimeout(() => {
        setSport('NFL');
        setGame('');
        setGameEventId('');
        setWager('2.00');
        setLegs([{ player: '', stat: '', statCategory: '', confidence: 'High' }]);
        setReasoning('');
        setSuccess(false);
      }, 3000);

    } catch (err) {
      console.error('❌ CATCH ERROR:', err);
      setError(err.message || 'Failed to submit pick');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="submit-pick-container">
      <h2>Submit a Pick for Analysis</h2>
      <p className="subtitle">Get AI-powered refinements based on expert betting strategies</p>

      <form onSubmit={handleSubmit} className="pick-form">
        {/* Sport Selection */}
        <div className="form-group">
          <label>Sport:</label>
          <select value={sport} onChange={(e) => setSport(e.target.value)}>
            <option value="NFL">NFL</option>
            <option value="NBA">NBA</option>
            <option value="NHL">NHL</option>
            <option value="CollegeBasketball">College Basketball</option>
          </select>
        </div>

        {/* Game Selection */}
        <div className="form-group">
          <label>Game:</label>
          {gameLoading ? (
            <div className="loading-text">Loading games...</div>
          ) : (
            <select 
              value={game} 
              onChange={(e) => {
                const selectedGame = games.find(g => g.name === e.target.value);
                setGame(e.target.value);
                setGameEventId(selectedGame?.eventId || '');
              }}
              disabled={games.length === 0}
            >
              <option value="">Select a game...</option>
              {games.map(g => (
                <option key={g.id} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          {games.length === 0 && !gameLoading && (
            <div className="helper-text">No games available for this sport</div>
          )}
        </div>

        {/* Wager Amount */}
        <div className="form-group">
          <label>Wager Amount ($):</label>
          <input
            type="number"
            step="0.01"
            min="0.50"
            max="1000"
            value={wager}
            onChange={(e) => setWager(e.target.value)}
            placeholder="Enter wager amount"
          />
          <div className="helper-text">Recommended: $1.50 - $4.00 for optimal Kelly sizing</div>
        </div>

        {/* Legs Section */}
        <div className="legs-section">
          <h3>Parlay Legs ({legs.length})</h3>
          {legs.map((leg, index) => (
            <LegForm
              key={index}
              leg={leg}
              index={index}
              sport={sport}
              gameId={game}
              gameEventId={gameEventId}
              onUpdate={updateLeg}
              onRemove={removeLeg}
              canRemove={legs.length > 1}
            />
          ))}
          <button type="button" onClick={addLeg} className="add-leg-btn">
            + Add Leg
          </button>
          <div className="helper-text">
            Recommended: 5-7 legs for best hit rate. Too many legs = exponential difficulty.
          </div>
        </div>

        {/* Reasoning */}
        <div className="form-group">
          <label>Why do you like these picks?</label>
          <textarea
            placeholder="Share your reasoning and any edge you see..."
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            rows="4"
          />
          <div className="helper-text">Optional: Help us understand your edge</div>
        </div>

        {/* Messages */}
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">✅ Pick submitted and analyzed!</div>}

        {/* Submit Button */}
        <button type="submit" disabled={loading} className="submit-btn">
          {loading ? 'Analyzing...' : 'Submit Pick for Analysis'}
        </button>
      </form>

      {/* Analysis Results */}
      {analysis && <PickAnalysis analysis={analysis} />}
    </div>
  );
}
