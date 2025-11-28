// FILE LOCATION: src/pages/Home.jsx
// PaiGrade - Premium bet analytics with SplitMates-inspired design

import { useState } from 'react';
import { auth } from '../firebase/config';
import SubmitPick from './SubmitPick';
import History from './History';
import Dashboard from './Dashboard';
import '../styles/Home.css';

// Icons
const Icons = {
  Upload: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  Clock: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  TrendingUp: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 17" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  LogOut: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  Settings: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m5.08 5.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m5.08-5.08l4.24-4.24" />
    </svg>
  )
};

export default function Home() {
  const [activeTab, setActiveTab] = useState('submit');

  const handleLogout = async () => {
    try {
      await auth.signOut();
    } catch (err) {
      console.error('Error logging out:', err);
    }
  };

  const navItems = [
    { id: 'submit', label: 'Submit Bet', icon: Icons.Upload },
    { id: 'history', label: 'History', icon: Icons.Clock },
    { id: 'dashboard', label: 'Analytics', icon: Icons.TrendingUp }
  ];

  return (
    <div className="home-container">
      {/* Header */}
      <header className="home-header">
        <div className="header-content">
          <div className="header-left">
            <h1 className="header-title">PaiGrade</h1>
          </div>
          <div className="header-right">
            <button className="icon-btn">
              <Icons.Settings />
            </button>
            <button onClick={handleLogout} className="logout-btn">
              <Icons.LogOut />
            </button>
          </div>
        </div>

        {/* Navigation Pills */}
        <nav className="nav-pills">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-pill ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <item.icon />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {activeTab === 'submit' && <SubmitPick />}
        {activeTab === 'history' && <History />}
        {activeTab === 'dashboard' && <Dashboard />}
      </main>
    </div>
  );
}
