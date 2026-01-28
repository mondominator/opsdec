import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../database/init.js';

// JWT secret - in production, this should be set via environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'opsdec-default-secret-change-in-production';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * Generate an access token for a user
 */
export function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Generate a random refresh token
 */
export function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Hash a refresh token for storage
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Store a refresh token in the database
 */
export function storeRefreshToken(userId, token) {
  const tokenHash = hashToken(token);
  const expiresAt = Math.floor(Date.now() / 1000) + (REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60);

  db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).run(userId, tokenHash, expiresAt);

  return { token, expiresAt };
}

/**
 * Validate a refresh token and return the user
 */
export function validateRefreshToken(token) {
  const tokenHash = hashToken(token);
  const now = Math.floor(Date.now() / 1000);

  const tokenRecord = db.prepare(`
    SELECT rt.*, au.username, au.is_admin, au.is_active
    FROM refresh_tokens rt
    JOIN auth_users au ON rt.user_id = au.id
    WHERE rt.token_hash = ? AND rt.expires_at > ?
  `).get(tokenHash, now);

  if (!tokenRecord) {
    return null;
  }

  if (!tokenRecord.is_active) {
    return null;
  }

  return {
    id: tokenRecord.user_id,
    username: tokenRecord.username,
    is_admin: tokenRecord.is_admin
  };
}

/**
 * Invalidate a refresh token (logout)
 */
export function invalidateRefreshToken(token) {
  const tokenHash = hashToken(token);
  db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
}

/**
 * Invalidate all refresh tokens for a user
 */
export function invalidateAllUserTokens(userId) {
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
}

/**
 * Clean up expired refresh tokens
 */
export function cleanupExpiredTokens() {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now);
  return result.changes;
}

/**
 * Check if setup is required (no users exist)
 */
export function isSetupRequired() {
  const count = db.prepare('SELECT COUNT(*) as count FROM auth_users').get();
  return count.count === 0;
}

/**
 * Middleware to authenticate JWT access tokens
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if user still exists and is active
    const user = db.prepare('SELECT id, username, is_admin, is_active FROM auth_users WHERE id = ?').get(decoded.id);

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

/**
 * Middleware to require admin privileges
 */
export function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

/**
 * Verify JWT token (for WebSocket authentication)
 */
export function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if user still exists and is active
    const user = db.prepare('SELECT id, username, is_admin, is_active FROM auth_users WHERE id = ?').get(decoded.id);

    if (!user || !user.is_active) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin
    };
  } catch (error) {
    return null;
  }
}
