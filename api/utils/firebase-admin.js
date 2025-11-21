// FILE LOCATION: api/utils/firebase-admin.js

import admin from 'firebase-admin';

let adminApp;

function getAdminApp() {
  if (adminApp) return adminApp;

  try {
    const serviceAccount = {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
    };

    adminApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });

    return adminApp;
  } catch (error) {
    console.error('Firebase Admin init error:', error.message);
    throw error;
  }
}

export function getFirestoreAdmin() {
  getAdminApp();
  return admin.firestore();
}

export async function writePicks(picks) {
  const db = getFirestoreAdmin();
  const batch = db.batch();
  for (const pick of picks) {
    const docRef = db.collection('picks').doc(pick.id);
    batch.set(docRef, pick, { merge: true });
  }
  await batch.commit();
  return picks.length;
}

export async function getCurrentPicks() {
  const db = getFirestoreAdmin();
  const snapshot = await db.collection('picks').where('pickStatus', '==', 'pending').get();
  const picks = [];
  snapshot.forEach(doc => {
    picks.push({ id: doc.id, ...doc.data() });
  });
  return picks;
}

export async function updatePickStatus(pickId, status, outcome) {
  const db = getFirestoreAdmin();
  await db.collection('picks').doc(pickId).update({
    pickStatus: status,
    outcome,
    lastUpdated: Math.floor(Date.now() / 1000),
  });
}

export async function writeAccuracyStats(stats) {
  const db = getFirestoreAdmin();
  const docId = `${stats.sport}_${stats.consensusLevel}_${stats.period}`;
  await db.collection('accuracyStats').doc(docId).set(stats, { merge: true });
}

export async function getAccuracyStats(period = 'allTime', sport = 'all') {
  const db = getFirestoreAdmin();
  let query = db.collection('accuracyStats').where('period', '==', period);
  if (sport !== 'all') {
    query = query.where('sport', '==', sport);
  }
  const snapshot = await query.get();
  const stats = [];
  snapshot.forEach(doc => {
    stats.push({ id: doc.id, ...doc.data() });
  });
  return stats;
}

export async function checkPickExists(pickId) {
  const db = getFirestoreAdmin();
  const snapshot = await db.collection('picks').doc(pickId).get();
  return snapshot.exists;
}
