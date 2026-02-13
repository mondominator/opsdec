import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDatabase } from '../setup.js';

// Set a known JWT_SECRET for tests before importing modules
process.env.JWT_SECRET = 'test-secret-key-for-integration-tests';

// Mock the database module to use in-memory test DB
let testDb;
vi.mock('../../src/database/init.js', () => {
  return {
    get db() { return testDb; },
    get default() { return testDb; },
    initDatabase: vi.fn(),
  };
});

// Mock rate limiter to be a pass-through in tests
vi.mock('express-rate-limit', () => {
  return {
    default: () => (req, res, next) => next(),
  };
});

// Dynamic imports after mocking
const { default: express } = await import('express');
const { default: cookieParser } = await import('cookie-parser');
const { default: supertest } = await import('supertest');
const { default: authRouter } = await import('../../src/routes/auth.js');
const { generateAccessToken } = await import('../../src/middleware/auth.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', authRouter);
  return app;
}

describe('Auth Routes', () => {
  let app;
  let request;

  beforeEach(() => {
    testDb = createTestDatabase();
    app = createApp();
    request = supertest(app);
  });

  describe('GET /auth/setup-required', () => {
    it('returns true when no users exist', async () => {
      const res = await request.get('/auth/setup-required');

      expect(res.status).toBe(200);
      expect(res.body.setupRequired).toBe(true);
    });

    it('returns false after a user is registered', async () => {
      // Register a user first
      await request.post('/auth/register').send({
        username: 'admin',
        password: 'password123',
      });

      const res = await request.get('/auth/setup-required');
      expect(res.status).toBe(200);
      expect(res.body.setupRequired).toBe(false);
    });
  });

  describe('POST /auth/register', () => {
    it('registers the first user as admin', async () => {
      const res = await request.post('/auth/register').send({
        username: 'admin',
        password: 'password123',
      });

      expect(res.status).toBe(201);
      expect(res.body.user.username).toBe('admin');
      expect(res.body.user.is_admin).toBe(1);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
    });

    it('sets HTTP-only cookies on registration', async () => {
      const res = await request.post('/auth/register').send({
        username: 'admin',
        password: 'password123',
      });

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = cookies.join('; ');
      expect(cookieStr).toContain('opsdec_access_token');
      expect(cookieStr).toContain('opsdec_refresh_token');
      expect(cookieStr).toContain('HttpOnly');
    });

    it('rejects registration with missing username', async () => {
      const res = await request.post('/auth/register').send({
        password: 'password123',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('rejects registration with short username', async () => {
      const res = await request.post('/auth/register').send({
        username: 'ab',
        password: 'password123',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('3 characters');
    });

    it('rejects registration with short password', async () => {
      const res = await request.post('/auth/register').send({
        username: 'testuser',
        password: 'short',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('8 characters');
    });

    it('rejects duplicate username', async () => {
      await request.post('/auth/register').send({
        username: 'admin',
        password: 'password123',
      });

      // Second user needs admin auth
      const adminUser = testDb.prepare('SELECT * FROM auth_users WHERE username = ?').get('admin');
      const adminToken = generateAccessToken({ id: adminUser.id, username: 'admin', is_admin: 1 });

      const res = await request.post('/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'admin',
          password: 'password123',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already taken');
    });

    it('requires admin auth to register second user', async () => {
      // Register first user
      await request.post('/auth/register').send({
        username: 'admin',
        password: 'password123',
      });

      // Try to register second user without auth
      const res = await request.post('/auth/register').send({
        username: 'user2',
        password: 'password123',
      });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      // Register a user
      await request.post('/auth/register').send({
        username: 'testuser',
        password: 'password123',
      });
    });

    it('logs in with valid credentials', async () => {
      const res = await request.post('/auth/login').send({
        username: 'testuser',
        password: 'password123',
      });

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('testuser');
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
    });

    it('sets HTTP-only cookies on login', async () => {
      const res = await request.post('/auth/login').send({
        username: 'testuser',
        password: 'password123',
      });

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = cookies.join('; ');
      expect(cookieStr).toContain('opsdec_access_token');
      expect(cookieStr).toContain('opsdec_refresh_token');
    });

    it('rejects invalid password', async () => {
      const res = await request.post('/auth/login').send({
        username: 'testuser',
        password: 'wrongpassword',
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid');
    });

    it('rejects non-existent user', async () => {
      const res = await request.post('/auth/login').send({
        username: 'nonexistent',
        password: 'password123',
      });

      expect(res.status).toBe(401);
    });

    it('rejects inactive user', async () => {
      testDb.prepare('UPDATE auth_users SET is_active = 0 WHERE username = ?').run('testuser');

      const res = await request.post('/auth/login').send({
        username: 'testuser',
        password: 'password123',
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('disabled');
    });

    it('rejects missing credentials', async () => {
      const res = await request.post('/auth/login').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });
  });

  describe('POST /auth/refresh', () => {
    let refreshToken;

    beforeEach(async () => {
      const res = await request.post('/auth/register').send({
        username: 'testuser',
        password: 'password123',
      });
      refreshToken = res.body.refreshToken;
    });

    it('returns new access token with valid refresh token in body', async () => {
      const res = await request.post('/auth/refresh').send({
        refreshToken,
      });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
    });

    it('rejects invalid refresh token', async () => {
      const res = await request.post('/auth/refresh').send({
        refreshToken: 'invalid-token',
      });

      expect(res.status).toBe(401);
    });

    it('rejects missing refresh token', async () => {
      const res = await request.post('/auth/refresh').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Refresh token required');
    });
  });

  describe('POST /auth/logout', () => {
    let refreshToken;

    beforeEach(async () => {
      const res = await request.post('/auth/register').send({
        username: 'testuser',
        password: 'password123',
      });
      refreshToken = res.body.refreshToken;
    });

    it('invalidates the refresh token', async () => {
      const res = await request.post('/auth/logout').send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Logged out');

      // Token should no longer work
      const refreshRes = await request.post('/auth/refresh').send({ refreshToken });
      expect(refreshRes.status).toBe(401);
    });

    it('succeeds even without a refresh token', async () => {
      const res = await request.post('/auth/logout').send({});

      expect(res.status).toBe(200);
    });
  });

  describe('GET /auth/me', () => {
    let accessToken;

    beforeEach(async () => {
      const res = await request.post('/auth/register').send({
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com',
      });
      accessToken = res.body.accessToken;
    });

    it('returns current user info with valid token', async () => {
      const res = await request.get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('testuser');
      expect(res.body.user.email).toBe('test@example.com');
      expect(res.body.user.is_admin).toBe(1);
    });

    it('rejects unauthenticated request', async () => {
      const res = await request.get('/auth/me');

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /auth/password', () => {
    let accessToken;

    beforeEach(async () => {
      const res = await request.post('/auth/register').send({
        username: 'testuser',
        password: 'password123',
      });
      accessToken = res.body.accessToken;
    });

    it('changes password successfully', async () => {
      const res = await request.put('/auth/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          currentPassword: 'password123',
          newPassword: 'newpassword456',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Password changed');

      // Can login with new password
      const loginRes = await request.post('/auth/login').send({
        username: 'testuser',
        password: 'newpassword456',
      });
      expect(loginRes.status).toBe(200);
    });

    it('rejects incorrect current password', async () => {
      const res = await request.put('/auth/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          currentPassword: 'wrongpassword',
          newPassword: 'newpassword456',
        });

      expect(res.status).toBe(401);
    });

    it('rejects short new password', async () => {
      const res = await request.put('/auth/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          currentPassword: 'password123',
          newPassword: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('8 characters');
    });

    it('rejects missing fields', async () => {
      const res = await request.put('/auth/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('invalidates existing refresh tokens after password change', async () => {
      // Get a refresh token
      const loginRes = await request.post('/auth/login').send({
        username: 'testuser',
        password: 'password123',
      });
      const refreshToken = loginRes.body.refreshToken;

      // Change password
      await request.put('/auth/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          currentPassword: 'password123',
          newPassword: 'newpassword456',
        });

      // Old refresh token should no longer work
      const refreshRes = await request.post('/auth/refresh').send({ refreshToken });
      expect(refreshRes.status).toBe(401);
    });
  });

  describe('Admin user management', () => {
    let adminToken;

    beforeEach(async () => {
      // Register first user (admin)
      const res = await request.post('/auth/register').send({
        username: 'admin',
        password: 'password123',
      });
      adminToken = res.body.accessToken;
    });

    describe('GET /auth/users', () => {
      it('lists all users for admin', async () => {
        const res = await request.get('/auth/users')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.users).toHaveLength(1);
        expect(res.body.users[0].username).toBe('admin');
      });

      it('rejects non-admin', async () => {
        // Create a non-admin user
        await request.post('/auth/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ username: 'regular', password: 'password123' });

        const loginRes = await request.post('/auth/login').send({
          username: 'regular',
          password: 'password123',
        });
        const userToken = loginRes.body.accessToken;

        const res = await request.get('/auth/users')
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(403);
      });
    });

    describe('POST /auth/users', () => {
      it('creates a new user', async () => {
        const res = await request.post('/auth/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username: 'newuser',
            password: 'password123',
            email: 'new@example.com',
          });

        expect(res.status).toBe(201);
        expect(res.body.user.username).toBe('newuser');
        expect(res.body.user.is_admin).toBe(0);
      });

      it('creates an admin user when is_admin is true', async () => {
        const res = await request.post('/auth/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username: 'newadmin',
            password: 'password123',
            is_admin: true,
          });

        expect(res.status).toBe(201);
        expect(res.body.user.is_admin).toBe(1);
      });

      it('rejects duplicate username', async () => {
        await request.post('/auth/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ username: 'user1', password: 'password123' });

        const res = await request.post('/auth/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ username: 'user1', password: 'password123' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('already taken');
      });
    });

    describe('PUT /auth/users/:id', () => {
      let userId;

      beforeEach(async () => {
        const res = await request.post('/auth/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ username: 'editme', password: 'password123' });
        userId = res.body.user.id;
      });

      it('updates username', async () => {
        const res = await request.put(`/auth/users/${userId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ username: 'updated' });

        expect(res.status).toBe(200);
        expect(res.body.user.username).toBe('updated');
      });

      it('deactivates a user', async () => {
        const res = await request.put(`/auth/users/${userId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false });

        expect(res.status).toBe(200);
        expect(res.body.user.is_active).toBe(0);
      });

      it('prevents admin from demoting themselves', async () => {
        const adminUser = testDb.prepare('SELECT id FROM auth_users WHERE username = ?').get('admin');

        const res = await request.put(`/auth/users/${adminUser.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_admin: false });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Cannot remove');
      });

      it('prevents admin from deactivating themselves', async () => {
        const adminUser = testDb.prepare('SELECT id FROM auth_users WHERE username = ?').get('admin');

        const res = await request.put(`/auth/users/${adminUser.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Cannot deactivate');
      });

      it('returns 404 for non-existent user', async () => {
        const res = await request.put('/auth/users/999')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ username: 'nope' });

        expect(res.status).toBe(404);
      });
    });

    describe('DELETE /auth/users/:id', () => {
      let userId;

      beforeEach(async () => {
        const res = await request.post('/auth/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ username: 'deleteme', password: 'password123' });
        userId = res.body.user.id;
      });

      it('deletes a user', async () => {
        const res = await request.delete(`/auth/users/${userId}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('deleted');

        // User should no longer exist
        const user = testDb.prepare('SELECT id FROM auth_users WHERE id = ?').get(userId);
        expect(user).toBeUndefined();
      });

      it('prevents admin from deleting themselves', async () => {
        const adminUser = testDb.prepare('SELECT id FROM auth_users WHERE username = ?').get('admin');

        const res = await request.delete(`/auth/users/${adminUser.id}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Cannot delete');
      });

      it('returns 404 for non-existent user', async () => {
        const res = await request.delete('/auth/users/999')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(404);
      });
    });
  });
});
