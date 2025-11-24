// FILE LOCATION: src/pages/Home.jsx
import { useState } from 'react';
import { auth } from '../firebase/config';
import SubmitPick from './SubmitPick';
import PickHistory from './PickHistory';
import Dashboard from './Dashboard';
import '../styles/Home.css';

export default function Home() {
  const [activeTab, setActiveTab] = useState('submit');

  const handleLogout = async () => {
    try {
      await auth.signOut();
    } catch (err) {
      console.error('Error logging out:', err);
    }
  };

  return (
    <div className="home-container">
      {/* Header */}
      <div className="home-header">
        <div className="header-content">
          <h1>Consensus Picks MVP</h1>
          <p className="tagline">AI-powered parlay analysis & refinement</p>
        </div>
        <button onClick={handleLogout} className="logout-btn">
          Logout
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="nav-tabs">
        <button 
          className={`nav-btn ${activeTab === 'submit' ? 'active' : ''}`}
          onClick={() => setActiveTab('submit')}
        >
          Submit Pick
        </button>
        <button 
          className={`nav-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
        <button 
          className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'submit' && <SubmitPick />}
        {activeTab === 'history' && <PickHistory />}
        {activeTab === 'dashboard' && <Dashboard />}
      </div>
    </div>
  );
}
