// FILE LOCATION: src/pages/SubmitPick.jsx
// Premium bet upload with native betting app empty state design

import { useState } from 'react';
import { auth } from '../firebase/config';
import '../styles/SubmitPick.css';

// Icons
const Icons = {
  Upload: () => (
    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  BetSlip: () => (
    <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
      <line x1="7" y1="8" x2="17" y2="8" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="7" y1="16" x2="17" y2="16" />
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

      setSuccess('✓ Bet analyzed successfully!');
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

      {/* Upload Card */}
      {!selectedImage ? (
        <div className="upload-card">
          <div
            className="upload-drop-zone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input').click()}
          >
            <div className="upload-icon">
              <Icons.BetSlip />
            </div>
            <h2>No Bets Submitted Yet</h2>
            <p>Upload your first bet slip to get AI analysis and grading</p>
            <button className="btn-upload">
              <Icons.Upload />
              <span>Choose Image or Drag Here</span>
            </button>
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
      ) : (
        /* Preview Card */
        <div className="upload-card">
          <div className="preview-card">
            <img src={selectedImage.preview} alt="Preview" className="preview-image" />
          </div>
          <div className="action-buttons">
            <button
              className="btn-secondary"
              onClick={() => setSelectedImage(null)}
              disabled={loading}
            >
              Change Image
            </button>
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? 'Analyzing...' : 'Analyze Bet'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
