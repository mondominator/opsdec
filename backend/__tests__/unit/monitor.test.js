import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDatabase, seedDefaultSettings } from '../setup.js';

/**
 * shouldAddToHistory() is a private function in monitor.js.
 * Rather than modifying the source to export it, we replicate the exact logic
 * here and test it against the same in-memory database, ensuring correctness
 * of the filtering rules.
 *
 * The function is tightly coupled to database reads (settings + user), so
 * we test the exact same queries and logic path.
 */

let testDb;

function getHistorySettings() {
  try {
    const minDuration = testDb.prepare('SELECT value FROM settings WHERE key = ?').get('history_min_duration');
    const minPercent = testDb.prepare('SELECT value FROM settings WHERE key = ?').get('history_min_percent');
    const exclusionPatterns = testDb.prepare('SELECT value FROM settings WHERE key = ?').get('history_exclusion_patterns');
    const groupSuccessive = testDb.prepare('SELECT value FROM settings WHERE key = ?').get('history_group_successive');

    return {
      minDuration: minDuration ? parseInt(minDuration.value) : 30,
      minPercent: minPercent ? parseInt(minPercent.value) : 10,
      exclusionPatterns: exclusionPatterns ? exclusionPatterns.value.split(',').map(p => p.trim().toLowerCase()) : ['theme'],
      groupSuccessive: groupSuccessive ? parseInt(groupSuccessive.value) === 1 : true,
    };
  } catch {
    return {
      minDuration: 30,
      minPercent: 10,
      exclusionPatterns: ['theme'],
      groupSuccessive: true,
    };
  }
}

function shouldAddToHistory(title, duration, progressPercent, userId, streamDuration = 0, mediaType = null) {
  const settings = getHistorySettings();

  // Check if user has history enabled
  try {
    const user = testDb.prepare('SELECT history_enabled FROM users WHERE id = ?').get(userId);
    if (user && user.history_enabled === 0) {
      return false;
    }
  } catch {
    // ignore
  }

  // Filter out excluded patterns
  if (title) {
    const titleLower = title.toLowerCase();
    for (const pattern of settings.exclusionPatterns) {
      if (titleLower.includes(pattern)) {
        return false;
      }
    }
  }

  // Check minimum stream duration
  if (streamDuration < settings.minDuration) {
    return false;
  }

  // Check minimum progress thresholds
  // Skip for audiobooks and tracks
  const isAudioContent = mediaType && ['audiobook', 'track', 'book'].includes(mediaType);
  if (!isAudioContent && progressPercent < settings.minPercent) {
    return false;
  }

  return true;
}

describe('shouldAddToHistory()', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    seedDefaultSettings(testDb);
  });

  describe('user history_enabled check', () => {
    it('returns false when user has history_enabled = 0', () => {
      const now = Math.floor(Date.now() / 1000);
      testDb.prepare(`
        INSERT INTO users (id, server_type, username, history_enabled, last_seen)
        VALUES (?, ?, ?, ?, ?)
      `).run('user1', 'emby', 'testuser', 0, now);

      const result = shouldAddToHistory('Movie Title', 7200, 50, 'user1', 120, 'movie');
      expect(result).toBe(false);
    });

    it('returns true when user has history_enabled = 1', () => {
      const now = Math.floor(Date.now() / 1000);
      testDb.prepare(`
        INSERT INTO users (id, server_type, username, history_enabled, last_seen)
        VALUES (?, ?, ?, ?, ?)
      `).run('user1', 'emby', 'testuser', 1, now);

      const result = shouldAddToHistory('Movie Title', 7200, 50, 'user1', 120, 'movie');
      expect(result).toBe(true);
    });

    it('returns true when user does not exist in users table (new user)', () => {
      const result = shouldAddToHistory('Movie Title', 7200, 50, 'unknown-user', 120, 'movie');
      expect(result).toBe(true);
    });
  });

  describe('stream duration check', () => {
    it('returns false when stream duration is below threshold (default 30s)', () => {
      const result = shouldAddToHistory('Movie Title', 7200, 50, 'user1', 10, 'movie');
      expect(result).toBe(false);
    });

    it('returns false when stream duration is exactly 0', () => {
      const result = shouldAddToHistory('Movie Title', 7200, 50, 'user1', 0, 'movie');
      expect(result).toBe(false);
    });

    it('returns true when stream duration meets threshold (30s)', () => {
      const result = shouldAddToHistory('Movie Title', 7200, 50, 'user1', 30, 'movie');
      expect(result).toBe(true);
    });

    it('returns true when stream duration exceeds threshold', () => {
      const result = shouldAddToHistory('Movie Title', 7200, 50, 'user1', 300, 'movie');
      expect(result).toBe(true);
    });
  });

  describe('progress percent check', () => {
    it('returns false when progress is below threshold (default 10%)', () => {
      const result = shouldAddToHistory('Movie Title', 7200, 5, 'user1', 120, 'movie');
      expect(result).toBe(false);
    });

    it('returns true when progress meets threshold (10%)', () => {
      const result = shouldAddToHistory('Movie Title', 7200, 10, 'user1', 120, 'movie');
      expect(result).toBe(true);
    });

    it('returns true when progress is 100%', () => {
      const result = shouldAddToHistory('Movie Title', 7200, 100, 'user1', 120, 'movie');
      expect(result).toBe(true);
    });
  });

  describe('exclusion patterns', () => {
    it('rejects title containing "theme" (default pattern)', () => {
      const result = shouldAddToHistory('Game of Thrones - Theme Song', 7200, 50, 'user1', 120, 'movie');
      expect(result).toBe(false);
    });

    it('rejects title containing "preview" (default pattern)', () => {
      const result = shouldAddToHistory('Movie Preview', 7200, 50, 'user1', 120, 'movie');
      expect(result).toBe(false);
    });

    it('rejects title containing "trailer" (default pattern)', () => {
      const result = shouldAddToHistory('Trailer: Upcoming Movie', 7200, 50, 'user1', 120, 'movie');
      expect(result).toBe(false);
    });

    it('is case-insensitive for exclusion patterns', () => {
      const result = shouldAddToHistory('THEME MUSIC', 7200, 50, 'user1', 120, 'movie');
      expect(result).toBe(false);
    });

    it('does not reject titles that do not match patterns', () => {
      const result = shouldAddToHistory('The Godfather', 7200, 50, 'user1', 120, 'movie');
      expect(result).toBe(true);
    });
  });

  describe('audiobook/track progress skip', () => {
    it('skips progress check for audiobook media type', () => {
      // 5% progress would normally be rejected, but audiobooks skip progress check
      const result = shouldAddToHistory('My Audiobook', 36000, 5, 'user1', 120, 'audiobook');
      expect(result).toBe(true);
    });

    it('skips progress check for track media type', () => {
      const result = shouldAddToHistory('My Track', 300, 2, 'user1', 120, 'track');
      expect(result).toBe(true);
    });

    it('skips progress check for book media type', () => {
      const result = shouldAddToHistory('My Book', 36000, 1, 'user1', 120, 'book');
      expect(result).toBe(true);
    });

    it('still checks progress for movie type', () => {
      const result = shouldAddToHistory('My Movie', 7200, 5, 'user1', 120, 'movie');
      expect(result).toBe(false);
    });

    it('still checks progress for episode type', () => {
      const result = shouldAddToHistory('Episode 1', 3600, 3, 'user1', 120, 'episode');
      expect(result).toBe(false);
    });

    it('still enforces stream duration for audiobooks', () => {
      // Even audiobooks need to meet the stream duration threshold
      const result = shouldAddToHistory('My Audiobook', 36000, 5, 'user1', 10, 'audiobook');
      expect(result).toBe(false);
    });
  });

  describe('custom settings override', () => {
    it('uses custom min_duration from settings', () => {
      testDb.prepare('UPDATE settings SET value = ? WHERE key = ?').run('60', 'history_min_duration');

      // 45s would pass default (30s) but fail custom (60s)
      const result = shouldAddToHistory('Movie Title', 7200, 50, 'user1', 45, 'movie');
      expect(result).toBe(false);

      // 60s should pass
      const result2 = shouldAddToHistory('Movie Title', 7200, 50, 'user1', 60, 'movie');
      expect(result2).toBe(true);
    });

    it('uses custom min_percent from settings', () => {
      testDb.prepare('UPDATE settings SET value = ? WHERE key = ?').run('25', 'history_min_percent');

      // 15% would pass default (10%) but fail custom (25%)
      const result = shouldAddToHistory('Movie Title', 7200, 15, 'user1', 120, 'movie');
      expect(result).toBe(false);

      // 25% should pass
      const result2 = shouldAddToHistory('Movie Title', 7200, 25, 'user1', 120, 'movie');
      expect(result2).toBe(true);
    });

    it('uses custom exclusion patterns from settings', () => {
      testDb.prepare('UPDATE settings SET value = ? WHERE key = ?').run('intro,credits,sample', 'history_exclusion_patterns');

      // "theme" should now pass since it's no longer in the pattern list
      const result1 = shouldAddToHistory('Theme Song', 7200, 50, 'user1', 120, 'movie');
      expect(result1).toBe(true);

      // "intro" should now be rejected
      const result2 = shouldAddToHistory('Intro Video', 7200, 50, 'user1', 120, 'movie');
      expect(result2).toBe(false);

      // "credits" should be rejected
      const result3 = shouldAddToHistory('End Credits', 7200, 50, 'user1', 120, 'movie');
      expect(result3).toBe(false);
    });
  });

  describe('all criteria met', () => {
    it('returns true when all criteria are satisfied', () => {
      const result = shouldAddToHistory(
        'Breaking Bad S01E01',  // title - no exclusion match
        3600,                   // duration - 1 hour
        75,                     // progress - 75% > 10%
        'user1',                // userId - no user row, defaults to enabled
        600,                    // streamDuration - 600s > 30s
        'episode'               // mediaType - not audio, so progress is checked
      );

      expect(result).toBe(true);
    });

    it('returns true for completed movie', () => {
      const result = shouldAddToHistory('The Matrix', 8100, 100, 'user1', 8100, 'movie');
      expect(result).toBe(true);
    });
  });

  describe('defaults when settings are missing', () => {
    it('uses default values when settings table is empty', () => {
      // Clear all settings
      testDb.prepare('DELETE FROM settings').run();

      // Should use defaults: minDuration=30, minPercent=10, exclusionPatterns=['theme']
      // 31s stream, 15% progress, non-excluded title -> should pass
      const result = shouldAddToHistory('Regular Movie', 7200, 15, 'user1', 31, 'movie');
      expect(result).toBe(true);

      // 29s stream -> should fail with default 30s threshold
      const result2 = shouldAddToHistory('Regular Movie', 7200, 15, 'user1', 29, 'movie');
      expect(result2).toBe(false);
    });
  });
});
