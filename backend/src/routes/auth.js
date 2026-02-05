import express from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { db } from '../database/init.js';
import {
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  validateRefreshToken,
  invalidateRefreshToken,
  invalidateAllUserTokens,
  isSetupRequired,
  authenticateToken,
  requireAdmin,
  cleanupExpiredTokens,
  setAuthCookies,
  clearAuthCookies,
  generateWsToken
} from '../middleware/auth.js';

const router = express.Router();
const SALT_ROUNDS = 12;

// Rate limiting for auth endpoints to prevent brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Use default key generator which handles IPv6 properly
  // X-Forwarded-For is automatically used when trust proxy is set
});

/**
 * GET /auth/setup-required
 * Check if initial setup is needed (no users exist)
 */
router.get('/setup-required', (req, res) => {
  try {
    const setupRequired = isSetupRequired();
    res.json({ setupRequired });
  } catch (error) {
    console.error('Error checking setup status:', error);
    res.status(500).json({ error: 'Failed to check setup status' });
  }
});

/**
 * POST /auth/register
 * Create a new user account
 * First user automatically becomes admin
 */
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if this is the first user (will be admin)
    const setupRequired = isSetupRequired();

    // If not first user, only admins can create users
    if (!setupRequired) {
      // Check for authorization
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        return res.status(401).json({ error: 'Only administrators can create new users' });
      }

      // Verify token and admin status
      const jwt = await import('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET || 'opsdec-default-secret-change-in-production';

      try {
        const decoded = jwt.default.verify(token, JWT_SECRET);
        const adminUser = db.prepare('SELECT is_admin FROM auth_users WHERE id = ?').get(decoded.id);

        if (!adminUser || !adminUser.is_admin) {
          return res.status(403).json({ error: 'Only administrators can create new users' });
        }
      } catch (error) {
        return res.status(401).json({ error: 'Invalid authorization' });
      }
    }

    // Check if username already exists
    const existingUser = db.prepare('SELECT id FROM auth_users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Check if email already exists (if provided)
    if (email) {
      const existingEmail = db.prepare('SELECT id FROM auth_users WHERE email = ?').get(email);
      if (existingEmail) {
        return res.status(400).json({ error: 'Email already registered' });
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user (first user is admin)
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`
      INSERT INTO auth_users (username, email, password_hash, is_admin, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(username, email || null, passwordHash, setupRequired ? 1 : 0, now, now);

    const user = {
      id: result.lastInsertRowid,
      username,
      is_admin: setupRequired ? 1 : 0
    };

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    storeRefreshToken(user.id, refreshToken);

    // Set HTTP-only cookies
    setAuthCookies(res, accessToken, refreshToken);

    console.log(`User ${username} registered${setupRequired ? ' as admin' : ''}`);

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        email: email || null,
        is_admin: user.is_admin
      },
      // Also return tokens in response for backwards compatibility
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

/**
 * POST /auth/login
 * Authenticate user and return tokens
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user
    const user = db.prepare(`
      SELECT id, username, email, password_hash, is_admin, is_active
      FROM auth_users WHERE username = ?
    `).get(username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is disabled' });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Update last login
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE auth_users SET last_login = ?, updated_at = ? WHERE id = ?').run(now, now, user.id);

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    storeRefreshToken(user.id, refreshToken);

    // Set HTTP-only cookies
    setAuthCookies(res, accessToken, refreshToken);

    // Clean up old expired tokens periodically
    cleanupExpiredTokens();

    console.log(`User ${username} logged in`);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin
      },
      // Also return tokens in response for backwards compatibility
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

/**
 * POST /auth/refresh
 * Get a new access token using refresh token
 * Supports both cookie and request body for refresh token
 */
router.post('/refresh', (req, res) => {
  try {
    // Try to get refresh token from cookie first, then from request body
    const refreshToken = req.cookies?.opsdec_refresh_token || req.body.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const user = validateRefreshToken(refreshToken);
    if (!user) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Generate new access token
    const accessToken = generateAccessToken(user);

    // Update the access token cookie
    setAuthCookies(res, accessToken, null);

    res.json({ accessToken });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

/**
 * POST /auth/logout
 * Invalidate refresh token and clear cookies
 */
router.post('/logout', (req, res) => {
  try {
    // Try to get refresh token from cookie first, then from request body
    const refreshToken = req.cookies?.opsdec_refresh_token || req.body.refreshToken;

    if (refreshToken) {
      invalidateRefreshToken(refreshToken);
    }

    // Clear HTTP-only cookies
    clearAuthCookies(res);

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

/**
 * GET /auth/me
 * Get current user info
 */
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT id, username, email, is_admin, last_login, created_at
      FROM auth_users WHERE id = ?
    `).get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Error getting user info:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * POST /auth/ws-token
 * Get a short-lived token for WebSocket authentication
 * Since JavaScript cannot access HTTP-only cookies, this endpoint
 * provides a short-lived token specifically for WebSocket connections
 */
router.post('/ws-token', authenticateToken, (req, res) => {
  try {
    const wsToken = generateWsToken(req.user);
    res.json({ wsToken });
  } catch (error) {
    console.error('Error generating WebSocket token:', error);
    res.status(500).json({ error: 'Failed to generate WebSocket token' });
  }
});

/**
 * PUT /auth/password
 * Change current user's password
 */
router.put('/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    // Get user with password hash
    const user = db.prepare('SELECT password_hash FROM auth_users WHERE id = ?').get(req.user.id);

    // Verify current password
    const passwordValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(newPasswordHash, now, req.user.id);

    // Invalidate all refresh tokens for this user (force re-login)
    invalidateAllUserTokens(req.user.id);

    console.log(`User ${req.user.username} changed password`);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Admin-only user management routes

/**
 * GET /auth/users
 * List all users (admin only)
 */
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, username, email, is_admin, is_active, last_login, created_at
      FROM auth_users
      ORDER BY created_at DESC
    `).all();

    res.json({ users });
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * POST /auth/users
 * Create a new user (admin only) - redirects to register
 */
router.post('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, email, is_admin } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if username already exists
    const existingUser = db.prepare('SELECT id FROM auth_users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Check if email already exists (if provided)
    if (email) {
      const existingEmail = db.prepare('SELECT id FROM auth_users WHERE email = ?').get(email);
      if (existingEmail) {
        return res.status(400).json({ error: 'Email already registered' });
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`
      INSERT INTO auth_users (username, email, password_hash, is_admin, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(username, email || null, passwordHash, is_admin ? 1 : 0, now, now);

    console.log(`Admin ${req.user.username} created user ${username}`);

    res.status(201).json({
      user: {
        id: result.lastInsertRowid,
        username,
        email: email || null,
        is_admin: is_admin ? 1 : 0,
        is_active: 1,
        created_at: now
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * PUT /auth/users/:id
 * Update a user (admin only)
 */
router.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { username, email, password, is_admin, is_active } = req.body;

    // Check user exists
    const existingUser = db.prepare('SELECT * FROM auth_users WHERE id = ?').get(userId);
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent admin from demoting themselves
    if (userId === req.user.id && is_admin === false) {
      return res.status(400).json({ error: 'Cannot remove your own admin privileges' });
    }

    // Prevent admin from deactivating themselves
    if (userId === req.user.id && is_active === false) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    const updates = [];
    const params = [];

    if (username !== undefined && username !== existingUser.username) {
      // Check if new username is taken
      const taken = db.prepare('SELECT id FROM auth_users WHERE username = ? AND id != ?').get(username, userId);
      if (taken) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      updates.push('username = ?');
      params.push(username);
    }

    if (email !== undefined && email !== existingUser.email) {
      if (email) {
        // Check if new email is taken
        const taken = db.prepare('SELECT id FROM auth_users WHERE email = ? AND id != ?').get(email, userId);
        if (taken) {
          return res.status(400).json({ error: 'Email already registered' });
        }
      }
      updates.push('email = ?');
      params.push(email || null);
    }

    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      updates.push('password_hash = ?');
      params.push(passwordHash);
    }

    if (is_admin !== undefined) {
      updates.push('is_admin = ?');
      params.push(is_admin ? 1 : 0);
    }

    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active ? 1 : 0);

      // If deactivating, invalidate all tokens
      if (!is_active) {
        invalidateAllUserTokens(userId);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const now = Math.floor(Date.now() / 1000);
    updates.push('updated_at = ?');
    params.push(now);
    params.push(userId);

    db.prepare(`UPDATE auth_users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Get updated user
    const updatedUser = db.prepare(`
      SELECT id, username, email, is_admin, is_active, last_login, created_at
      FROM auth_users WHERE id = ?
    `).get(userId);

    console.log(`Admin ${req.user.username} updated user ${updatedUser.username}`);

    res.json({ user: updatedUser });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * DELETE /auth/users/:id
 * Delete a user (admin only)
 */
router.delete('/users/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent admin from deleting themselves
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check user exists
    const existingUser = db.prepare('SELECT username FROM auth_users WHERE id = ?').get(userId);
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user (refresh tokens will be cascade deleted)
    db.prepare('DELETE FROM auth_users WHERE id = ?').run(userId);

    console.log(`Admin ${req.user.username} deleted user ${existingUser.username}`);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
