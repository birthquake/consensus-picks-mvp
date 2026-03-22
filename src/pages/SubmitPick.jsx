// FILE LOCATION: src/pages/SubmitPick.jsx

import { useState } from 'react';
import { auth } from '../firebase/config';
import '../styles/SubmitPick.css';

const Icons = {
  Upload: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
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
  Calendar: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
};

const LoadingSpinner = () => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', padding: '60px 20px', gap: '20px'
  }}>
    <div style={{
      width: '50px', height: '50px',
      border: '3px solid #1a1a1a', borderTop: '3px solid #00d4ff',
      borderRadius: '50%', animation: 'spin 1s linear infinite'
    }}>
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </div>
    <p style={{ color: '#999', fontSize: '16px', textAlign: 'center' }}>
      Analyzing your picks...
    </p>
  </div>
);

// Today's date in YYYY-MM-DD for the date input default
function todayISO() {
  return new Date().toISOString().split('T')[0];
}

export default function SubmitPick() {
  const [selectedImage, setSelectedImage] = useState(null);
  const [gameDate, setGameDate] = useState(todayISO());
  const [gameDateSource, setGameDateSource] = useState('default'); // 'slip' | 'default' | 'user'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);

  const compressImage = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;

          // Cap longest side at 1200px — bet slips don't need more resolution
          const MAX = 1200;
          if (width > height && width > MAX) {
            height = Math.round(height * MAX / width);
            width = MAX;
          } else if (height > width && height > MAX) {
            width = Math.round(width * MAX / height);
            height = MAX;
          } else if (width > MAX) {
            height = Math.round(height * MAX / width);
            width = MAX;
          }

          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);

          // Try quality 0.7 first, drop to 0.5 if still over 3MB base64
          let result = canvas.toDataURL('image/jpeg', 0.7);
          if (result.length > 3 * 1024 * 1024) {
            result = canvas.toDataURL('image/jpeg', 0.5);
          }
          resolve(result);
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleImageSelect = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('File must be less than 10MB'); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Only PNG, JPG, or WebP files allowed'); return;
    }
    try {
      setLoading(true); setError('');
      const compressedBase64 = await compressImage(file);
      setSelectedImage({ file, preview: compressedBase64, name: file.name });

      // Quick date extraction — send a tiny Claude call to read the date off the slip
      // This runs in the background while the user sees the preview
      extractDateFromSlip(compressedBase64);
    } catch {
      setError('Failed to process image. Please try another.');
    } finally {
      setLoading(false);
    }
  };

  // Fire-and-forget: ask the API to read the game date from the slip image.
  // If it succeeds we pre-fill the date picker; user can always override.
  const extractDateFromSlip = async (base64) => {
    try {
      const res = await fetch('/api/picks/extract-game-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64.split(',')[1] }),
      });
      if (!res.ok) return;
      const { game_date } = await res.json();
      if (game_date && /^\d{4}-\d{2}-\d{2}$/.test(game_date)) {
        setGameDate(game_date);
        setGameDateSource('slip');
      }
    } catch {
      // Silent — user can set date manually
    }
  };

  const handleDragOver = (e) => { e.preventDefault(); e.currentTarget.classList.add('active'); };
  const handleDragLeave = (e) => { e.currentTarget.classList.remove('active'); };
  const handleDrop = (e) => {
    e.preventDefault(); e.currentTarget.classList.remove('active');
    handleImageSelect(e.dataTransfer.files[0]);
  };

  const handleSubmit = async () => {
    if (!selectedImage) { setError('Please select an image'); return; }
    if (!gameDate) { setError('Please set the game date'); return; }

    try {
      setLoading(true); setError(''); setSuccess(''); setAnalysisResult(null);

      const response = await fetch('/api/picks/extract-and-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          imageBase64: selectedImage.preview.split(',')[1],
          imageName: selectedImage.name,
          game_date: gameDate,        // ← now explicitly passed
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to analyze bet slip');

      setAnalysisResult(data);
      setSuccess('Bet analyzed! Check History to see results.');
      setSelectedImage(null);
      setGameDate(todayISO());
      setGameDateSource('default');
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.message || 'Error uploading bet slip');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="submit-page">
      {error && (
        <div className="alert alert-error"><Icons.X /><span>{error}</span></div>
      )}
      {success && (
        <div className="alert alert-success"><Icons.Check /><span>{success}</span></div>
      )}
      {loading && <LoadingSpinner />}

      {/* ── Analysis results ── */}
      {analysisResult && !loading && (
        <div className="analysis-section">
          <div style={{
            display: 'flex', alignItems: 'center', gap: '20px',
            marginBottom: '30px', padding: '20px',
            backgroundColor: '#0a0a0a', borderRadius: '12px',
            borderLeft: '4px solid #00d4ff'
          }}>
            <div style={{ fontSize: '48px', fontWeight: 'bold', color: '#00d4ff', minWidth: '60px', textAlign: 'center' }}>
              {analysisResult.grade}
            </div>
            <div>
              <div style={{ color: '#999', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                Grade Assessment
              </div>
              <div style={{ color: '#00d4ff', fontSize: '16px', fontWeight: '600', marginBottom: '6px' }}>
                {analysisResult.grade === 'A' && '✓ Strong Pick'}
                {analysisResult.grade === 'B' && '✓ Good Pick'}
                {analysisResult.grade === 'C' && 'Moderate Risk'}
                {analysisResult.grade === 'D' && 'High Risk'}
                {analysisResult.grade === 'F' && '⚠ Poor Pick'}
              </div>
              <div style={{ color: '#ccc', fontSize: '13px', marginBottom: '8px' }}>
                {analysisResult.confidence} confidence
              </div>
              <div style={{ color: '#999', fontSize: '13px', lineHeight: '1.5' }}>
                {analysisResult.reason}
              </div>
            </div>
          </div>

          {analysisResult.analysis.pickAnalysis && (
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ color: '#00d4ff', fontSize: '18px', fontWeight: '600', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #1a1a1a' }}>
                Pick Analysis
              </h3>
              <p style={{ color: '#ccc', lineHeight: '1.6', fontSize: '14px' }}>
                {analysisResult.analysis.pickAnalysis}
              </p>
            </div>
          )}

          {analysisResult.analysis.strengths?.length > 0 && (
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ color: '#00d4ff', fontSize: '18px', fontWeight: '600', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #1a1a1a' }}>
                Strengths
              </h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {analysisResult.analysis.strengths.map((s, i) => (
                  <li key={i} style={{ color: '#ccc', fontSize: '14px', marginBottom: '10px', paddingLeft: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#00d4ff' }}>✓</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysisResult.analysis.risks?.length > 0 && (
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ color: '#00d4ff', fontSize: '18px', fontWeight: '600', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #1a1a1a' }}>
                Potential Risks
              </h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {analysisResult.analysis.risks.map((r, i) => (
                  <li key={i} style={{ color: '#ccc', fontSize: '14px', marginBottom: '10px', paddingLeft: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#ff6b6b' }}>⚠</span>{r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysisResult.analysis.recommendedAdjustments && (
            <div>
              <h3 style={{ color: '#00d4ff', fontSize: '18px', fontWeight: '600', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #1a1a1a' }}>
                Recommendations
              </h3>
              <p style={{ color: '#ccc', lineHeight: '1.6', fontSize: '14px' }}>
                {analysisResult.analysis.recommendedAdjustments}
              </p>
            </div>
          )}

          <button
            onClick={() => { setAnalysisResult(null); setSelectedImage(null); setGameDate(todayISO()); setGameDateSource('default'); }}
            style={{ marginTop: '30px', padding: '12px 24px', backgroundColor: '#00d4ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', width: '100%' }}
          >
            Submit Another Bet
          </button>
        </div>
      )}

      {/* ── Upload section ── */}
      {!selectedImage && !analysisResult && (
        <>
          <div className="upload-box">
            <div
              className="upload-zone"
              onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
              onClick={() => document.getElementById('file-input').click()}
            >
              <div className="upload-icon"><Icons.Upload /></div>
              <h2>Upload Bet Slip</h2>
              <p>Drag image here or click to browse</p>
              <p className="file-hint">PNG, JPG, or WebP (max 10MB)</p>
            </div>
            <input id="file-input" type="file" accept=".png,.jpg,.jpeg,.webp"
              onChange={(e) => handleImageSelect(e.target.files[0])}
              style={{ display: 'none' }} />
          </div>

          <div className="placeholder-section">
            <h3>Example Bet Slip</h3>
            <div className="fake-bet-slip">
              <div className="slip-header">
                <div className="slip-logo">DraftKings</div>
                <div className="slip-time">11:45 AM</div>
              </div>
              <div className="slip-picks">
                <div className="pick-row"><span className="pick-label">Pick 1</span><span className="pick-value">LeBron James O 24.5 Pts</span></div>
                <div className="pick-row"><span className="pick-label">Pick 2</span><span className="pick-value">Lakers vs Celtics ML</span></div>
                <div className="pick-row"><span className="pick-label">Pick 3</span><span className="pick-value">Jalen Brunson O 18.5 Ast</span></div>
              </div>
              <div className="slip-divider"></div>
              <div className="slip-footer">
                <div className="slip-row"><span>Wager</span><span>$50.00</span></div>
                <div className="slip-row"><span>Potential Win</span><span className="accent">$1,247.50</span></div>
              </div>
            </div>
            <p className="placeholder-hint">Upload your bet slip and we'll grade it with AI</p>
          </div>
        </>
      )}

      {/* ── Preview + date confirm + submit ── */}
      {selectedImage && !analysisResult && (
        <div className="preview-section">
          <div className="preview-image">
            <img src={selectedImage.preview} alt="Bet slip preview" />
          </div>

          {/* Game date selector */}
          <div className="game-date-row">
            <div className="game-date-label">
              <Icons.Calendar />
              <span>Game Date</span>
              {gameDateSource === 'slip' && (
                <span className="date-source-badge">read from slip</span>
              )}
              {gameDateSource === 'default' && (
                <span className="date-source-badge default">confirm before submitting</span>
              )}
            </div>
            <input
              type="date"
              className="date-input"
              value={gameDate}
              onChange={(e) => { setGameDate(e.target.value); setGameDateSource('user'); }}
              max={(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0]; })()}
            />
          </div>

          <div className="action-buttons">
            <button className="btn-secondary" onClick={() => { setSelectedImage(null); setGameDate(todayISO()); setGameDateSource('default'); }} disabled={loading}>
              Change
            </button>
            <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
              {loading ? 'Analyzing...' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
