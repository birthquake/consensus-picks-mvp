// FILE LOCATION: src/pages/Home.jsx
import { useState } from 'react';
import { auth } from '../firebase/config';
import { signOut } from 'firebase/auth';
import '../styles/Home.css';

export default function Home({ user }) {
  const [currentPage, setCurrentPage] = useState('submit'); // submit, history, dashboard

  const handleLogout = async () => {
    await signOut(auth);
  };

  return (
    <div className="home-container">
      <nav className="navbar">
        <h1>PickRefine</h1>
        <div className="nav-buttons">
          <button 
            className={currentPage === 'submit' ? 'active' : ''}
            onClick={() => setCurrentPage('submit')}
          >
            Submit Pick
          </button>
          <button 
            className={currentPage === 'history' ? 'active' : ''}
            onClick={() => setCurrentPage('history')}
          >
            History
          </button>
          <button 
            className={currentPage === 'dashboard' ? 'active' : ''}
            onClick={() => setCurrentPage('dashboard')}
          >
            Dashboard
          </button>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </nav>

      <div className="main-content">
        {currentPage === 'submit' && (
          <div className="page">
            <h2>Submit a Pick for Analysis</h2>
            <p>Coming soon... Pick submission form</p>
          </div>
        )}

        {currentPage === 'history' && (
          <div className="page">
            <h2>Your Submission History</h2>
            <p>Coming soon... Pick history and results</p>
          </div>
        )}

        {currentPage === 'dashboard' && (
          <div className="page">
            <h2>Your Betting Dashboard</h2>
            <p>Coming soon... Performance stats and trends</p>
          </div>
        )}
      </div>
    </div>
  );
}
