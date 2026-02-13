import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createTestDatabase } from '../setup.js';

// Set a known JWT_SECRET for tests before importing auth module
process.env.JWT_SECRET = 'test-secret-key-for-unit-tests';

// Mock the database module to use in-memory test DB
let testDb;
vi.mock('../../src/database/init.js', () => {
  return {
    get db() { return testDb; },
    get default() { return testDb; },
    initDatabase: vi.fn(),
  };
});

// Import auth functions after mocking
const {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  storeRefreshToken,
  validateRefreshToken,
  invalidateRefreshToken,
  invalidateAllUserTokens,
  verifyToken,
  authenticateToken,
  requireAdmin,
  isSetupRequired,
} = await import('../../src/middleware/auth.js');

describe('Auth Middleware', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe('generateAccessToken()', () => {
    it('returns a valid JWT containing user id, username, and is_admin', () => {
      const user = { id: 1, username: 'testuser', is_admin: 1 };
      const token = generateAccessToken(user);

      expect(token).toBeTypeOf('string');

      const decoded = jwt.verify(token, 'test-secret-key-for-unit-tests');
      expect(decoded.id).toBe(1);
      expect(decoded.username).toBe('testuser');
      expect(decoded.is_admin).toBe(1);
    });

    it('sets a 15-minute expiry', () => {
      const user = { id: 1, username: 'testuser', is_admin: 0 };
      const token = generateAccessToken(user);

      const decoded = jwt.verify(token, 'test-secret-key-for-unit-tests');
      // exp - iat should be ~900 seconds (15 minutes)
      expect(decoded.exp - decoded.iat).toBe(900);
    });
  });

  describe('generateRefreshToken()', () => {
    it('returns a 128-character hex string', () => {
      const token = generateRefreshToken();

      expect(token).toBeTypeOf('string');
      expect(token).toHaveLength(128);
      expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    it('returns unique tokens on each call', () => {
      const t1 = generateRefreshToken();
      const t2 = generateRefreshToken();

      expect(t1).not.toBe(t2);
    });
  });

  describe('hashToken()', () => {
    it('returns consistent SHA256 output for same input', () => {
      const hash1 = hashToken('test-token');
      const hash2 = hashToken('test-token');

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex = 64 chars
    });

    it('returns different hashes for different tokens', () => {
      const hash1 = hashToken('token-a');
      const hash2 = hashToken('token-b');

      expect(hash1).not.toBe(hash2);
    });

    it('matches node crypto SHA256 directly', () => {
      const token = 'my-test-token';
      const expected = crypto.createHash('sha256').update(token).digest('hex');
      expect(hashToken(token)).toBe(expected);
    });
  });

  describe('storeRefreshToken() / validateRefreshToken()', () => {
    let userId;

    beforeEach(() => {
      const now = Math.floor(Date.now() / 1000);
      const result = testDb.prepare(`
        INSERT INTO auth_users (username, password_hash, is_admin, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('testuser', 'fakehash', 1, 1, now, now);
      userId = result.lastInsertRowid;
    });

    it('stores a token and validates it successfully', () => {
      const rawToken = generateRefreshToken();
      storeRefreshToken(userId, rawToken);

      const user = validateRefreshToken(rawToken);
      expect(user).not.toBeNull();
      expect(user.id).toBe(userId);
      expect(user.username).toBe('testuser');
      expect(user.is_admin).toBe(1);
    });

    it('rejects an invalid token', () => {
      const rawToken = generateRefreshToken();
      storeRefreshToken(userId, rawToken);

      const user = validateRefreshToken('wrong-token');
      expect(user).toBeNull();
    });

    it('rejects an expired token', () => {
      const rawToken = generateRefreshToken();
      const tokenHash = hashToken(rawToken);
      const expiredAt = Math.floor(Date.now() / 1000) - 1; // expired 1 second ago

      testDb.prepare(`
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES (?, ?, ?)
      `).run(userId, tokenHash, expiredAt);

      const user = validateRefreshToken(rawToken);
      expect(user).toBeNull();
    });

    it('rejects token for inactive user', () => {
      // Deactivate the user
      testDb.prepare('UPDATE auth_users SET is_active = 0 WHERE id = ?').run(userId);

      const rawToken = generateRefreshToken();
      storeRefreshToken(userId, rawToken);

      const user = validateRefreshToken(rawToken);
      expect(user).toBeNull();
    });
  });

  describe('invalidateRefreshToken()', () => {
    let userId;

    beforeEach(() => {
      const now = Math.floor(Date.now() / 1000);
      const result = testDb.prepare(`
        INSERT INTO auth_users (username, password_hash, is_admin, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('testuser', 'fakehash', 1, 1, now, now);
      userId = result.lastInsertRowid;
    });

    it('removes the token so it can no longer validate', () => {
      const rawToken = generateRefreshToken();
      storeRefreshToken(userId, rawToken);

      // Should be valid before invalidation
      expect(validateRefreshToken(rawToken)).not.toBeNull();

      invalidateRefreshToken(rawToken);

      // Should be invalid after invalidation
      expect(validateRefreshToken(rawToken)).toBeNull();
    });
  });

  describe('invalidateAllUserTokens()', () => {
    let userId;

    beforeEach(() => {
      const now = Math.floor(Date.now() / 1000);
      const result = testDb.prepare(`
        INSERT INTO auth_users (username, password_hash, is_admin, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('testuser', 'fakehash', 1, 1, now, now);
      userId = result.lastInsertRowid;
    });

    it('removes all tokens for the user', () => {
      const token1 = generateRefreshToken();
      const token2 = generateRefreshToken();
      storeRefreshToken(userId, token1);
      storeRefreshToken(userId, token2);

      // Both should be valid
      expect(validateRefreshToken(token1)).not.toBeNull();
      expect(validateRefreshToken(token2)).not.toBeNull();

      invalidateAllUserTokens(userId);

      // Both should now be invalid
      expect(validateRefreshToken(token1)).toBeNull();
      expect(validateRefreshToken(token2)).toBeNull();
    });
  });

  describe('verifyToken()', () => {
    let userId;

    beforeEach(() => {
      const now = Math.floor(Date.now() / 1000);
      const result = testDb.prepare(`
        INSERT INTO auth_users (username, password_hash, is_admin, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('testuser', 'fakehash', 0, 1, now, now);
      userId = result.lastInsertRowid;
    });

    it('returns user object for a valid JWT', () => {
      const token = generateAccessToken({ id: userId, username: 'testuser', is_admin: 0 });

      const user = verifyToken(token);
      expect(user).not.toBeNull();
      expect(user.id).toBe(userId);
      expect(user.username).toBe('testuser');
      expect(user.is_admin).toBe(0);
    });

    it('returns null for an invalid JWT', () => {
      const user = verifyToken('invalid.token.here');
      expect(user).toBeNull();
    });

    it('returns null for a valid JWT but inactive user', () => {
      const token = generateAccessToken({ id: userId, username: 'testuser', is_admin: 0 });
      testDb.prepare('UPDATE auth_users SET is_active = 0 WHERE id = ?').run(userId);

      const user = verifyToken(token);
      expect(user).toBeNull();
    });

    it('returns null for a valid JWT but deleted user', () => {
      const token = generateAccessToken({ id: userId, username: 'testuser', is_admin: 0 });
      testDb.prepare('DELETE FROM auth_users WHERE id = ?').run(userId);

      const user = verifyToken(token);
      expect(user).toBeNull();
    });
  });

  describe('authenticateToken() middleware', () => {
    let userId;

    beforeEach(() => {
      const now = Math.floor(Date.now() / 1000);
      const result = testDb.prepare(`
        INSERT INTO auth_users (username, password_hash, is_admin, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('testuser', 'fakehash', 1, 1, now, now);
      userId = result.lastInsertRowid;
    });

    function createMockReq(token, source = 'header') {
      const req = {
        cookies: {},
        headers: {},
      };
      if (source === 'header') {
        req.headers['authorization'] = `Bearer ${token}`;
      } else if (source === 'cookie') {
        req.cookies.opsdec_access_token = token;
      }
      return req;
    }

    function createMockRes() {
      const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; },
      };
      return res;
    }

    it('calls next() and sets req.user for valid token in Authorization header', () => {
      const token = generateAccessToken({ id: userId, username: 'testuser', is_admin: 1 });
      const req = createMockReq(token, 'header');
      const res = createMockRes();
      let nextCalled = false;

      authenticateToken(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe(userId);
      expect(req.user.username).toBe('testuser');
      expect(req.user.is_admin).toBe(1);
    });

    it('calls next() and sets req.user for valid token in cookie', () => {
      const token = generateAccessToken({ id: userId, username: 'testuser', is_admin: 1 });
      const req = createMockReq(token, 'cookie');
      const res = createMockRes();
      let nextCalled = false;

      authenticateToken(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(req.user.id).toBe(userId);
    });

    it('returns 401 when no token is provided', () => {
      const req = { cookies: {}, headers: {} };
      const res = createMockRes();
      let nextCalled = false;

      authenticateToken(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Access token required');
    });

    it('returns 403 for an invalid token', () => {
      const req = createMockReq('bad-token', 'header');
      const res = createMockRes();
      let nextCalled = false;

      authenticateToken(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
    });

    it('returns 401 for an expired token', () => {
      const token = jwt.sign(
        { id: userId, username: 'testuser', is_admin: 1 },
        'test-secret-key-for-unit-tests',
        { expiresIn: '0s' }
      );

      // Small delay to ensure token has expired
      const req = createMockReq(token, 'header');
      const res = createMockRes();
      let nextCalled = false;

      authenticateToken(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body.code).toBe('TOKEN_EXPIRED');
    });

    it('returns 401 for inactive user', () => {
      const token = generateAccessToken({ id: userId, username: 'testuser', is_admin: 1 });
      testDb.prepare('UPDATE auth_users SET is_active = 0 WHERE id = ?').run(userId);

      const req = createMockReq(token, 'header');
      const res = createMockRes();
      let nextCalled = false;

      authenticateToken(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('requireAdmin() middleware', () => {
    it('calls next() when user is admin', () => {
      const req = { user: { id: 1, username: 'admin', is_admin: 1 } };
      const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; },
      };
      let nextCalled = false;

      requireAdmin(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('returns 403 when user is not admin', () => {
      const req = { user: { id: 1, username: 'user', is_admin: 0 } };
      const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; },
      };
      let nextCalled = false;

      requireAdmin(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Admin privileges required');
    });

    it('returns 403 when req.user is missing', () => {
      const req = {};
      const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; },
      };
      let nextCalled = false;

      requireAdmin(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('isSetupRequired()', () => {
    it('returns true when no users exist', () => {
      expect(isSetupRequired()).toBe(true);
    });

    it('returns false when users exist', () => {
      const now = Math.floor(Date.now() / 1000);
      testDb.prepare(`
        INSERT INTO auth_users (username, password_hash, is_admin, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('admin', 'fakehash', 1, 1, now, now);

      expect(isSetupRequired()).toBe(false);
    });
  });
});
