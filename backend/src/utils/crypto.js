import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const ENCRYPTED_PREFIX = 'enc:';

/**
 * Get encryption key from environment variable
 * Returns null if not configured (encryption disabled)
 */
function getKey() {
  const key = process.env.API_KEY_ENCRYPTION_KEY;
  if (!key) return null;
  // Create a 32-byte key from the provided secret using SHA-256
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt a plaintext value
 * @param {string} text - The plaintext to encrypt
 * @returns {string} - Encrypted string with 'enc:' prefix, or original if encryption disabled
 */
export function encrypt(text) {
  if (!text) return text;

  const key = getKey();
  if (!key) {
    // Encryption not configured, return plaintext
    return text;
  }

  // Already encrypted
  if (text.startsWith(ENCRYPTED_PREFIX)) {
    return text;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Format: enc:iv:encrypted
  return `${ENCRYPTED_PREFIX}${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an encrypted value
 * @param {string} text - The encrypted string (with 'enc:' prefix)
 * @returns {string} - Decrypted plaintext, or original if not encrypted
 */
export function decrypt(text) {
  if (!text) return text;

  // Not encrypted, return as-is
  if (!text.startsWith(ENCRYPTED_PREFIX)) {
    return text;
  }

  const key = getKey();
  if (!key) {
    // Encryption key not available - cannot decrypt
    // This would happen if API_KEY_ENCRYPTION_KEY was removed after encrypting
    console.warn('Warning: Encrypted value found but API_KEY_ENCRYPTION_KEY not set');
    return text;
  }

  try {
    const parts = text.split(':');
    if (parts.length !== 3) {
      console.warn('Warning: Invalid encrypted format');
      return text;
    }

    const [, ivHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Error decrypting value:', error.message);
    return text;
  }
}

/**
 * Check if encryption is enabled
 * @returns {boolean}
 */
export function isEncryptionEnabled() {
  return !!process.env.API_KEY_ENCRYPTION_KEY;
}

/**
 * Check if a value is encrypted
 * @param {string} text
 * @returns {boolean}
 */
export function isEncrypted(text) {
  return text?.startsWith(ENCRYPTED_PREFIX) ?? false;
}

/**
 * Mask a value for display (show only last 4 characters)
 * @param {string} text
 * @returns {string}
 */
export function maskApiKey(text) {
  if (!text) return '***';
  // Don't expose even partial encrypted values
  if (text.startsWith(ENCRYPTED_PREFIX)) return '***';
  // For plaintext keys, mask all but last 4 chars
  if (text.length <= 4) return '***';
  return '***' + text.slice(-4);
}
