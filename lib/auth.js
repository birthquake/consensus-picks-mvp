// FILE LOCATION: lib/auth.js
// Server-side Firebase ID token verification — every API endpoint except the
// cron (which uses CRON_SECRET) was previously unauthenticated: anyone could
// trigger real Claude API charges or write arbitrary data directly, with no
// login required. The frontend already gates the whole app behind sign-in
// (App.jsx), so this just enforces server-side what the UI already assumed.

import { getApp, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function getAdminApp() {
  try {
    return getApp();
  } catch {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
    return initializeApp({ credential: cert(serviceAccount) });
  }
}

/**
 * Verifies the request carries a valid Firebase ID token in its
 * Authorization header. On success, returns the decoded token (uid, email,
 * etc.). On failure, sends a 401 response itself and returns null — callers
 * must check for null and return immediately without doing any other work:
 *
 *   const user = await requireAuth(req, res);
 *   if (!user) return;
 */
export async function requireAuth(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return null;
  }

  try {
    return await getAuth(getAdminApp()).verifyIdToken(token);
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}
