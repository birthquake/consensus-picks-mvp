// FILE LOCATION: src/pages/SubmitPick.jsx
// Clean bet upload with fake bet slip placeholder

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

export default function SubmitPick() {
  const [selectedImage, setSelectedImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleImageSelect = (file) => {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('File must be less than 5MB');
      return;
    }

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Only PNG, JPG, or WebP files allowed');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setSelectedImage({
        file: file,
        preview: e.target.result,
        name: file.name
      });
      setError('');
    };
    reader.readAsDataURL(file);
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

      {/* Upload Section */}
      {!selectedImage ? (
        <>
          {/* Upload Box */}
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
      ) : (
        /* Preview & Submit */
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
