// FILE LOCATION: src/pages/Home.jsx
import { useState } from 'react';
import { auth } from '../firebase/config';
import { useTheme } from '../context/ThemeContext';
import Halftime from './Halftime';
import '../styles/Home.css';

export default function Home() {
  const { isDark, toggleTheme } = useTheme();

  const handleLogout = async () => {
    try {
      await auth.signOut();
    } catch (err) {
      console.error('Error logging out:', err);
    }
  };

  return (
    <div className="home-container">
      <main className="main-content">
        <Halftime
          isDark={isDark}
          toggleTheme={toggleTheme}
          onLogout={handleLogout}
        />
      </main>
    </div>
  );
}
