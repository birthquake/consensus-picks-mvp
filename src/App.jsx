// FILE LOCATION: src/App.jsx
import { useEffect, useState } from 'react';
import './App.css';
import { auth } from './firebase/config';
import { ThemeProvider } from './context/ThemeContext';
import Home from './pages/Home';
import Login from './pages/Login';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <ThemeProvider>
      <div className="app">
        {user ? <Home user={user} /> : <Login />}
      </div>
    </ThemeProvider>
  );
}
