// FILE LOCATION: tests/auth.test.js
// requireAuth() itself calls firebase-admin's verifyIdToken, which needs a
// real Firebase project to validate a real token against — not something
// unit tests can exercise end-to-end. What IS testable, and what actually
// matters most for safety, is that the rejection path never lets a request
// through: no header, a malformed header, or a garbage token must all 401
// and return null before any caller could act on a truthy "user".

import { describe, it, expect } from 'vitest';
import { requireAuth } from '../lib/auth.js';

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

describe('requireAuth', () => {
  it('rejects a request with no Authorization header at all', async () => {
    const res = mockRes();
    const user = await requireAuth({ headers: {} }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it('rejects a header that is not a Bearer token', async () => {
    const res = mockRes();
    const user = await requireAuth({ headers: { authorization: 'Basic abc123' } }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it('rejects a syntactically invalid token rather than throwing', async () => {
    const res = mockRes();
    const user = await requireAuth({ headers: { authorization: 'Bearer not-a-real-jwt' } }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});
