// FILE LOCATION: src/pages/SubmitPick.jsx
// SIMPLIFIED: No image storage, base64 → Claude → store extracted data only

import { useState, useRef } from 'react';
import { db, auth } from '../firebase/config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import '../styles/SubmitPick.css';

// SVG Icons
const Icons = {
  Upload: () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  X: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Check: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  AlertCircle: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
};

export default function SubmitPick() {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);
  const fileInputRef = useRef(null);

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  const validateFile = (file) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please upload a JPEG, PNG, or WebP image');
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Image must be smaller than 5MB');
      return false;
    }
    return true;
  };

  const handleFileSelect = (file) => {
    setError('');
    
    if (!validateFile(file)) {
      return;
    }

    setImage(file);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  };

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove('drag-over');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!image) {
      setError('Please select an image');
      return;
    }

    if (!auth.currentUser) {
      setError('You must be logged in');
      return;
    }

    setLoading(true);
    setError('');
    setAnalysisResult(null);

    try {
      // Convert image to base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        const imageBase64 = e.target.result.split(',')[1];

        // Send base64 and media type directly to Claude for extraction + analysis
        const response = await fetch('/api/picks/extract-and-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: auth.currentUser.uid,
            imageBase64,
            imageMediaType: image.type  // ← Pass actual media type (image/jpeg, image/png, image/webp)
          })
        });

        const data = await response.json();

        if (!data.success) {
          setError(data.error || 'Failed to analyze bet slip');
          setLoading(false);
          return;
        }

        // Success!
        setAnalysisResult(data);
        setSuccess(true);
        setSuccessMessage(`✓ Bet analyzed! ${data.picks.length} picks identified`);
        
        // Reset form after 3 seconds
        setTimeout(() => {
          setImage(null);
          setPreview(null);
          setSuccess(false);
          setSuccessMessage('');
          setAnalysisResult(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }, 3000);
      };

      reader.readAsDataURL(image);

    } catch (err) {
      console.error('Error:', err);
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const clearImage = () => {
    setImage(null);
    setPreview(null);
    setError('');
    setAnalysisResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="sp-upload-container">
      {/* Header */}
      <div className="sp-upload-header">
        <h1>Upload Your Bet Slip</h1>
        <p>Take a screenshot of your bet and we'll analyze it for you</p>
      </div>

      {/* Main Content */}
      <div className="sp-upload-content">
        {!preview ? (
          // Upload Area
          <form onSubmit={handleSubmit}>
            <div
              className="sp-upload-zone"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileInputChange}
                style={{ display: 'none' }}
              />

              <div className="sp-upload-icon">
                <Icons.Upload />
              </div>

              <h2>Drag image here</h2>
              <p>or click to select</p>
              <small>PNG, JPG, or WebP (max 5MB)</small>
            </div>

            {error && (
              <div className="sp-error-message">
                <Icons.AlertCircle />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="sp-success-message">
                <Icons.Check />
                <span>{successMessage}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !image}
              className="sp-submit-btn"
            >
              {loading ? 'Analyzing...' : 'Submit for Analysis'}
            </button>
          </form>
        ) : (
          // Preview Area
          <div className="sp-preview-section">
            <div className="sp-preview-image">
              <img src={preview} alt="Bet slip preview" />
            </div>

            <div className="sp-preview-info">
              <h2>Ready to analyze?</h2>
              <p>File: {image.name}</p>
              <p>Size: {(image.size / 1024).toFixed(1)} KB</p>

              {error && (
                <div className="sp-error-message">
                  <Icons.AlertCircle />
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div className="sp-success-message">
                  <Icons.Check />
                  <span>{successMessage}</span>
                </div>
              )}

              <div className="sp-preview-actions">
                <button
                  onClick={clearImage}
                  disabled={loading}
                  className="sp-cancel-btn"
                >
                  Choose Different
                </button>

                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="sp-analyze-btn"
                >
                  {loading ? 'Analyzing...' : 'Analyze This Bet'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Analysis Result */}
        {analysisResult && (
          <div className="sp-analysis-result">
            <h2>Analysis Complete</h2>
            <p className="analysis-intro">Your personalized analysis:</p>
            <div className="analysis-text">
              {analysisResult.analysis}
            </div>
            <p className="analysis-note">
              ✓ Your bet has been saved to your history and will be tracked when results come in.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
