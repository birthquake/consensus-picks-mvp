// FILE LOCATION: src/pages/SubmitPick.jsx
// Clean bet upload with image compression + loading animation + styled analysis

import { useState } from 'react';
import { auth } from '../firebase/config';
import '../styles/SubmitPick.css';

// Icons
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
  )
};

// Loading spinner animation
const LoadingSpinner = () => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    gap: '20px'
  }}>
    <div style={{
      width: '50px',
      height: '50px',
      border: '3px solid #1a1a1a',
      borderTop: '3px solid #00d4ff',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    }}>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
    <p style={{
      color: '#999',
      fontSize: '16px',
      textAlign: 'center'
    }}>
      Analyzing your picks<span style={{ animation: 'dots 1.5s steps(3, end) infinite' }}>...</span>
      <style>{`
        @keyframes dots {
          0%, 20% { content: '.'; }
          40% { content: '..'; }
          60%, 100% { content: '...'; }
        }
      `}</style>
    </p>
  </div>
);

export default function SubmitPick() {
  const [selectedImage, setSelectedImage] = useState(null);
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
          let width = img.width;
          let height = img.height;

          if (height > 2000) {
            const ratio = width / height;
            height = 2000;
            width = height * ratio;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
          resolve(compressedBase64);
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

    if (file.size > 5 * 1024 * 1024) {
      setError('File must be less than 5MB');
      return;
    }

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Only PNG, JPG, or WebP files allowed');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      const compressedBase64 = await compressImage(file);
      
      setSelectedImage({
        file: file,
        preview: compressedBase64,
        name: file.name
      });
    } catch (err) {
      setError('Failed to process image. Please try another.');
    } finally {
      setLoading(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('active');
  };

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove('active');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('active');
    handleImageSelect(e.dataTransfer.files[0]);
  };

  const handleSubmit = async () => {
    if (!selectedImage) {
      setError('Please select an image');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccess('');
      setAnalysisResult(null);

      const base64 = selectedImage.preview.split(',')[1];

      const response = await fetch('/api/picks/extract-and-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          imageBase64: base64,
          imageName: selectedImage.name
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze bet slip');
      }

      setAnalysisResult(data);
      setSuccess('Bet analyzed! Check History to see results.');
      setSelectedImage(null);
      
      setTimeout(() => {
        setSuccess('');
      }, 5000);

    } catch (err) {
      setError(err.message || 'Error uploading bet slip');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="submit-page">
      {/* Error Alert */}
      {error && (
        <div className="alert alert-error">
          <Icons.X />
          <span>{error}</span>
        </div>
      )}

      {/* Success Alert */}
      {success && (
        <div className="alert alert-success">
          <Icons.Check />
          <span>{success}</span>
        </div>
      )}

      {/* Loading Animation */}
      {loading && (
        <LoadingSpinner />
      )}

      {/* Analysis Results */}
      {analysisResult && !loading && (
        <div className="analysis-section">
          {/* Grade Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            marginBottom: '30px',
            padding: '20px',
            backgroundColor: '#0a0a0a',
            borderRadius: '12px',
            borderLeft: '4px solid #00d4ff'
          }}>
            <div style={{
              fontSize: '48px',
              fontWeight: 'bold',
              color: '#00d4ff',
              minWidth: '60px',
              textAlign: 'center'
            }}>
              {analysisResult.grade}
            </div>
            <div>
              <div style={{ color: '#00d4ff', fontSize: '14px', fontWeight: '600' }}>
                Confidence: {analysisResult.confidence}
              </div>
              <div style={{ color: '#999', fontSize: '14px', marginTop: '4px' }}>
                {analysisResult.reason}
              </div>
            </div>
          </div>

          {/* Pick Analysis */}
          {analysisResult.analysis.pickAnalysis && (
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{
                color: '#00d4ff',
                fontSize: '18px',
                fontWeight: '600',
                marginBottom: '12px',
                paddingBottom: '8px',
                borderBottom: '1px solid #1a1a1a'
              }}>
                Pick Analysis
              </h3>
              <p style={{
                color: '#ccc',
                lineHeight: '1.6',
                fontSize: '14px'
              }}>
                {analysisResult.analysis.pickAnalysis}
              </p>
            </div>
          )}

          {/* Strengths */}
          {analysisResult.analysis.strengths && analysisResult.analysis.strengths.length > 0 && (
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{
                color: '#00d4ff',
                fontSize: '18px',
                fontWeight: '600',
                marginBottom: '12px',
                paddingBottom: '8px',
                borderBottom: '1px solid #1a1a1a'
              }}>
                Strengths
              </h3>
              <ul style={{
                listStyle: 'none',
                padding: 0,
                margin: 0
              }}>
                {analysisResult.analysis.strengths.map((strength, idx) => (
                  <li key={idx} style={{
                    color: '#ccc',
                    fontSize: '14px',
                    marginBottom: '10px',
                    paddingLeft: '20px',
                    position: 'relative'
                  }}>
                    <span style={{
                      position: 'absolute',
                      left: 0,
                      color: '#00d4ff'
                    }}>✓</span>
                    {strength}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks */}
          {analysisResult.analysis.risks && analysisResult.analysis.risks.length > 0 && (
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{
                color: '#00d4ff',
                fontSize: '18px',
                fontWeight: '600',
                marginBottom: '12px',
                paddingBottom: '8px',
                borderBottom: '1px solid #1a1a1a'
              }}>
                Potential Risks
              </h3>
              <ul style={{
                listStyle: 'none',
                padding: 0,
                margin: 0
              }}>
                {analysisResult.analysis.risks.map((risk, idx) => (
                  <li key={idx} style={{
                    color: '#ccc',
                    fontSize: '14px',
                    marginBottom: '10px',
                    paddingLeft: '20px',
                    position: 'relative'
                  }}>
                    <span style={{
                      position: 'absolute',
                      left: 0,
                      color: '#ff6b6b'
                    }}>⚠</span>
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {analysisResult.analysis.recommendedAdjustments && (
            <div>
              <h3 style={{
                color: '#00d4ff',
                fontSize: '18px',
                fontWeight: '600',
                marginBottom: '12px',
                paddingBottom: '8px',
                borderBottom: '1px solid #1a1a1a'
              }}>
                Recommendations
              </h3>
              <p style={{
                color: '#ccc',
                lineHeight: '1.6',
                fontSize: '14px'
              }}>
                {analysisResult.analysis.recommendedAdjustments}
              </p>
            </div>
          )}

          {/* New Bet Button */}
          <button
            onClick={() => {
              setAnalysisResult(null);
              setSelectedImage(null);
            }}
            style={{
              marginTop: '30px',
              padding: '12px 24px',
              backgroundColor: '#00d4ff',
              color: '#000',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              width: '100%'
            }}
          >
            Submit Another Bet
          </button>
        </div>
      )}

      {/* Upload Section */}
      {!selectedImage && !analysisResult && (
        <>
          <div className="upload-box">
            <div
              className="upload-zone"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-input').click()}
            >
              <div className="upload-icon">
                <Icons.Upload />
              </div>
              <h2>Upload Bet Slip</h2>
              <p>Drag image here or click to browse</p>
              <p className="file-hint">PNG, JPG, or WebP (max 5MB)</p>
            </div>
            <input
              id="file-input"
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              onChange={(e) => handleImageSelect(e.target.files[0])}
              style={{ display: 'none' }}
            />
          </div>

          {/* Fake Bet Slip Placeholder */}
          <div className="placeholder-section">
            <h3>Example Bet Slip</h3>
            <div className="fake-bet-slip">
              <div className="slip-header">
                <div className="slip-logo">DraftKings</div>
                <div className="slip-time">11:45 AM</div>
              </div>

              <div className="slip-picks">
                <div className="pick-row">
                  <span className="pick-label">Pick 1</span>
                  <span className="pick-value">LeBron James O 24.5 Pts</span>
                </div>
                <div className="pick-row">
                  <span className="pick-label">Pick 2</span>
                  <span className="pick-value">Lakers vs Celtics ML</span>
                </div>
                <div className="pick-row">
                  <span className="pick-label">Pick 3</span>
                  <span className="pick-value">Jalen Brunson O 18.5 Ast</span>
                </div>
              </div>

              <div className="slip-divider"></div>

              <div className="slip-footer">
                <div className="slip-row">
                  <span>Wager</span>
                  <span>$50.00</span>
                </div>
                <div className="slip-row">
                  <span>Potential Win</span>
                  <span className="accent">$1,247.50</span>
                </div>
              </div>
            </div>
            <p className="placeholder-hint">Upload your bet slip and we'll grade it with AI</p>
          </div>
        </>
      )}

      {/* Preview & Submit */}
      {selectedImage && !analysisResult && (
        <div className="preview-section">
          <div className="preview-image">
            <img src={selectedImage.preview} alt="Bet slip preview" />
          </div>

          <div className="action-buttons">
            <button
              className="btn-secondary"
              onClick={() => setSelectedImage(null)}
              disabled={loading}
            >
              Change
            </button>
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? 'Analyzing...' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
