// FILE LOCATION: src/lib/apiFetch.js
// Wraps fetch() to attach the signed-in user's Firebase ID token as a
// Bearer token — every /api/* endpoint now requires one (see lib/auth.js on
// the server side, requireAuth()). The whole app is already gated behind a
// signed-in user (App.jsx only renders Halftime once auth.currentUser
// exists), so a token should always be available by the time these fire.

import { auth } from '../firebase/config';

export async function apiFetch(url, options = {}) {
  const token = await auth.currentUser?.getIdToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}
