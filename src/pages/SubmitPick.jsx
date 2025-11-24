// FILE LOCATION: src/pages/SubmitPick.jsx
import { useState } from 'react';
import { db, auth } from '../firebase/config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import LegForm from '../components/LegForm';
import '../styles/SubmitPick.css';

export default function SubmitPick() {
  const [sport, setSport] = useState('NFL');
  const [game, setGame] = useState('');
  const [wager, setWager] = useState('2.00');
  const [legs, setLegs] = useState([
    { player: '', stat: '', threshold: '', confidence: 'High' }
  ]);
  const [reasoning, setReasoning] = useState('');
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const addLeg = () => {
    setLegs([...legs, { player: '', stat: '', threshold: '', confidence: 'High' }]);
  };

  const removeLeg = (index) => {
    setLegs(legs.filter((_, i) => i !== index));
  };

  const updateLeg = (index, field, value) => {
    const newLegs = [...legs];
    newLegs[index][field] = value;
    setLegs(newLegs);
  };

  const handleScreenshotUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setScreenshot(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate inputs
      if (!game.trim()) {
        setError('Please enter a game');
        setLoading(false);
        return;
      }

      const filledLegs = legs.filter(leg => leg.player && leg.stat && leg.threshold);
      if (filledLegs.length === 0) {
        setError('Please add at least one leg');
        setLoading(false);
        return;
      }

      // Create pick submission
      const pickData = {
        userId: auth.currentUser.uid,
        sport,
        game,
        wager: parseFloat(wager),
        originalLegs: filledLegs,
        reasoning,
        submittedAt: serverTimestamp(),
        status: 'pending_analysis',
        // These will be populated by the analysis function
        analysis: null,
        userDecision: 'pending',
        result: null
      };

      // Add to Firestore
      const docRef = await addDoc(
        collection(db, 'users', auth.currentUser.uid, 'submitted_picks'),
        pickData
      );

      setSuccess(true);
      // Reset form
      setSport('NFL');
      setGame('');
      setWager('2.00');
      setLegs([{ player: '', stat: '', threshold: '', confidence: 'High' }]);
      setReasoning('');
      setScreenshot(null);

      setTimeout(() => {
        setSuccess(false);
      }, 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="submit-pick-container">
      <h2>Submit a Pick for Analysis</h2>

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
          <input
            type="text"
            placeholder="e.g., KC Chiefs vs JAX Jaguars"
            value={game}
            onChange={(e) => setGame(e.target.value)}
          />
        </div>

        {/* Wager Amount */}
        <div className="form-group">
          <label>Wager Amount ($):</label>
          <input
            type="number"
            step="0.01"
            min="0.50"
            value={wager}
            onChange={(e) => setWager(e.target.value)}
          />
        </div>

        {/* Legs Section */}
        <div className="legs-section">
          <h3>Parlay Legs</h3>
          {legs.map((leg, index) => (
            <LegForm
              key={index}
              leg={leg}
              index={index}
              onUpdate={updateLeg}
              onRemove={removeLeg}
              canRemove={legs.length > 1}
            />
          ))}
          <button type="button" onClick={addLeg} className="add-leg-btn">
            + Add Leg
          </button>
        </div>

        {/* Reasoning */}
        <div className="form-group">
          <label>Why do you like these picks?</label>
          <textarea
            placeholder="Share your reasoning..."
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            rows="4"
          />
        </div>

        {/* Screenshot Upload (Future) */}
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={screenshotMode}
              onChange={(e) => setScreenshotMode(e.target.checked)}
            />
            Upload Bet Slip Screenshot (Coming Soon)
          </label>
          {screenshotMode && (
            <input type="file" accept="image/*" onChange={handleScreenshotUpload} />
          )}
        </div>

        {/* Error/Success Messages */}
        {error && <div className="error">{error}</div>}
        {success && (
          <div className="success">Pick submitted! Analyzing now...</div>
        )}

        {/* Submit Button */}
        <button type="submit" disabled={loading} className="submit-btn">
          {loading ? 'Submitting...' : 'Submit Pick for Analysis'}
        </button>
      </form>
    </div>
  );
}
