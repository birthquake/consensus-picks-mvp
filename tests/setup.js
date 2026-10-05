// FILE LOCATION: tests/setup.js
// Some API files (api/moneyline.js, api/cron/fetch-game-results.js,
// api/halftime/picks.js) initialize firebase-admin at module load time, so
// just importing them for their pure, testable functions throws without
// real-looking credentials. Generates a throwaway RSA keypair fresh each
// test run (never committed, never touches anything real) so cert()'s
// PEM/ASN.1 parsing succeeds and the module loads — actual Firestore calls
// would still fail with UNAUTHENTICATED, which is fine, since the functions
// under test here are pure and never make network/Firestore calls.

import { generateKeyPairSync } from 'crypto';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'test',
  private_key: privateKey,
  client_email: 'test@test-project.iam.gserviceaccount.com',
  client_id: '123',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
});

process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
