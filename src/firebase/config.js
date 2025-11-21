// FILE LOCATION: src/firebase/config.js

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBsslxZlk7vg_aYehC9O8A4yBVYtKwd7J4',
  authDomain: 'consensus-picks-mvp.firebaseapp.com',
  projectId: 'consensus-picks-mvp',
  storageBucket: 'consensus-picks-mvp.firebasestorage.app',
  messagingSenderId: '541139038054',
  appId: '1:541139038054:web:980d3ebecc69ea41c4a2a7',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
export const db = getFirestore(app);

export default app;
