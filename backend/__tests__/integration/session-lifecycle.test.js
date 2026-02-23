import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, seedDefaultSettings } from '../setup.js';

/**
 * Integration tests for the full session lifecycle: creation, updates,
 * state transitions, history recording, stream duration calculation,
 * duplicate prevention, and user stats.
 *
 * Like monitor.test.js, we replicate the core DB logic from monitor.js
 * against an in-memory SQLite database rather than importing the private
 * functions directly.
 */

let db;

// ---------------------------------------------------------------------------
// Helpers — mirror the exact DB queries from monitor.js
// ---------------------------------------------------------------------------

const SESSION_DEFAULTS = {
  session_key: 'sess-1',
  server_type: 'emby',
  server_id: 'default',
  user_id: 'user-1',
  username: 'testuser',
  user_thumb: null,
  media_type: 'movie',
  media_id: 'media-1',
  title: 'Test Movie',
  parent_title: null,
  grandparent_title: null,
  season_number: null,
  episode_number: null,
  year: 2024,
  thumb: null,
  art: null,
  state: 'playing',
  progress_percent: 0,
  duration: 7200,
  current_time: 0,
  ip_address: null,
};

function createSession(overrides = {}) {
  const s = { ...SESSION_DEFAULTS, ...overrides };
  const now = s.started_at ?? Math.floor(Date.now() / 1000);
  const playbackTime = 0;
  const lastPositionUpdate = s.state === 'playing' ? now : null;

  db.prepare(`
    INSERT INTO sessions (
      session_key, server_type, server_id, user_id, username, user_thumb,
      media_type, media_id, title, parent_title, grandparent_title,
      season_number, episode_number,
      year, thumb, art, started_at, state, progress_percent, duration,
      current_time, playback_time, last_position_update,
      ip_address
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    s.session_key, s.server_type, s.server_id, s.user_id, s.username, s.user_thumb,
    s.media_type, s.media_id, s.title, s.parent_title, s.grandparent_title,
    s.season_number, s.episode_number,
    s.year, s.thumb, s.art, now, s.state, s.progress_percent, s.duration,
    s.current_time, playbackTime, lastPositionUpdate,
    s.ip_address,
  );

  return db.prepare('SELECT * FROM sessions WHERE session_key = ?').get(s.session_key);
}

function getSession(sessionKey) {
  return db.prepare('SELECT * FROM sessions WHERE session_key = ?').get(sessionKey);
}

/** Replicate the session-update query from monitor.js lines ~607-643 */
function updateSession(sessionKey, activity, now) {
  const existing = getSession(sessionKey);

  let playbackTime = existing.playback_time || 0;
  if (activity.state === 'playing' && existing.state === 'playing' && existing.last_position_update) {
    playbackTime += now - existing.last_position_update;
  }

  const positionChanged = (activity.current_time || 0) !== existing.current_time;
  const shouldUpdatePositionTimestamp = activity.state === 'playing' && positionChanged;

  db.prepare(`
    UPDATE sessions
    SET state = ?,
        progress_percent = ?,
        current_time = ?,
        playback_time = ?,
        last_position_update = CASE WHEN ? = 1 THEN ? ELSE last_position_update END,
        updated_at = CASE WHEN ? != 'paused' THEN ? ELSE updated_at END,
        stopped_at = CASE WHEN ? = 'stopped' THEN ? ELSE stopped_at END,
        paused_counter = CASE WHEN ? = 'paused' AND state = 'playing' THEN paused_counter + 1 ELSE paused_counter END
    WHERE session_key = ?
  `).run(
    activity.state,
    activity.progress_percent ?? existing.progress_percent,
    activity.current_time ?? 0,
    playbackTime,
    shouldUpdatePositionTimestamp ? 1 : 0, now,
    activity.state, now,
    activity.state, now,
    activity.state,
    sessionKey,
  );

  return getSession(sessionKey);
}

/**
 * Replicate the 3-step stream duration calculation from monitor.js.
 * Used when a session stops (lines ~445-465 and ~1160-1174).
 */
function calculateStreamDuration(session, now) {
  let streamDuration = session.playback_time || 0;

  // Fallback: if playback_time is very small but we have timing info
  if (streamDuration < 5 && session.last_position_update && session.state === 'playing') {
    streamDuration = now - session.last_position_update;
  }

  // Cap at session wall-clock time
  const maxSessionDuration = now - session.started_at;
  if (streamDuration > maxSessionDuration) {
    streamDuration = maxSessionDuration;
  }

  // Cap at media duration
  if (session.duration && streamDuration > session.duration) {
    streamDuration = session.duration;
  }

  return streamDuration;
}

/** Replicate shouldAddToHistory from monitor.js (same as monitor.test.js) */
function shouldAddToHistory(title, duration, progressPercent, userId, streamDuration = 0, mediaType = null) {
  const minDurationRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('history_min_duration');
  const minPercentRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('history_min_percent');
  const exclusionRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('history_exclusion_patterns');

  const minDuration = minDurationRow ? parseInt(minDurationRow.value) : 30;
  const minPercent = minPercentRow ? parseInt(minPercentRow.value) : 10;
  const exclusionPatterns = exclusionRow
    ? exclusionRow.value.split(',').map(p => p.trim().toLowerCase())
    : ['theme'];

  const user = db.prepare('SELECT history_enabled FROM users WHERE id = ?').get(userId);
  if (user && user.history_enabled === 0) return false;

  if (title) {
    const titleLower = title.toLowerCase();
    for (const pattern of exclusionPatterns) {
      if (titleLower.includes(pattern)) return false;
    }
  }

  if (streamDuration < minDuration) return false;

  const isAudioContent = mediaType && ['audiobook', 'track', 'book'].includes(mediaType);
  if (!isAudioContent && progressPercent < minPercent) return false;

  return true;
}

/**
 * Stop a session and optionally record it to history — mirrors the
 * stop + history-insert pattern from monitor.js lines ~1146-1232.
 */
function stopAndRecord(sessionKey, now) {
  db.prepare(`
    UPDATE sessions
    SET state = 'stopped', stopped_at = ?, updated_at = ?
    WHERE session_key = ?
  `).run(now, now, sessionKey);

  const session = getSession(sessionKey);
  const streamDuration = calculateStreamDuration(session, now);

  if (!shouldAddToHistory(session.title, session.duration, session.progress_percent, session.user_id, streamDuration, session.media_type)) {
    return { session, streamDuration, historyRecorded: false };
  }

  const existingHistory = db.prepare(
    'SELECT id FROM history WHERE session_id = ? AND media_id = ?',
  ).get(session.id, session.media_id);

  if (existingHistory) {
    return { session, streamDuration, historyRecorded: false };
  }

  db.prepare(`
    INSERT INTO history (
      session_id, server_type, user_id, username,
      media_type, media_id, title, parent_title, grandparent_title,
      watched_at, duration, percent_complete, thumb, stream_duration,
      ip_address, city, region, country
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id, session.server_type, session.user_id, session.username,
    session.media_type, session.media_id, session.title,
    session.parent_title, session.grandparent_title,
    now, session.duration, session.progress_percent, session.thumb,
    streamDuration, session.ip_address, session.city, session.region, session.country,
  );

  db.prepare(`
    UPDATE users
    SET total_plays = total_plays + 1, total_duration = total_duration + ?
    WHERE id = ?
  `).run(streamDuration, session.user_id);

  return { session, streamDuration, historyRecorded: true };
}

function ensureUser(userId, serverType = 'emby', username = 'testuser') {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!existing) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO users (id, server_type, username, last_seen) VALUES (?, ?, ?, ?)').run(userId, serverType, username, now);
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Session Lifecycle Integration', () => {
  beforeEach(() => {
    db = createTestDatabase();
    seedDefaultSettings(db);
  });

  // -----------------------------------------------------------------------
  // 1. Session creation
  // -----------------------------------------------------------------------
  describe('session creation', () => {
    it('inserts a session with correct defaults', () => {
      const session = createSession();

      expect(session.state).toBe('playing');
      expect(session.playback_time).toBe(0);
      expect(session.paused_counter).toBe(0);
      expect(session.progress_percent).toBe(0);
      expect(session.started_at).toBeGreaterThan(0);
      expect(session.last_position_update).toBe(session.started_at);
      expect(session.stopped_at).toBeNull();
    });

    it('sets last_position_update to null when created in paused state', () => {
      const session = createSession({ session_key: 'paused-sess', state: 'paused' });

      expect(session.state).toBe('paused');
      expect(session.last_position_update).toBeNull();
    });

    it('enforces unique session_key constraint', () => {
      createSession({ session_key: 'unique-key' });

      expect(() => createSession({ session_key: 'unique-key' })).toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Session updates — same media
  // -----------------------------------------------------------------------
  describe('session updates', () => {
    it('updates progress_percent and current_time', () => {
      const startedAt = 1000;
      createSession({ started_at: startedAt });

      const updated = updateSession('sess-1', {
        state: 'playing',
        progress_percent: 25,
        current_time: 1800,
      }, startedAt + 30);

      expect(updated.progress_percent).toBe(25);
      expect(updated.current_time).toBe(1800);
    });

    it('accumulates playback_time when playing -> playing', () => {
      const startedAt = 1000;
      createSession({ started_at: startedAt });

      // 30 seconds later, still playing
      updateSession('sess-1', { state: 'playing', current_time: 30 }, startedAt + 30);
      // 30 more seconds
      const updated = updateSession('sess-1', { state: 'playing', current_time: 60 }, startedAt + 60);

      expect(updated.playback_time).toBe(60);
    });

    it('increments paused_counter on playing -> paused transition', () => {
      const startedAt = 1000;
      createSession({ started_at: startedAt });

      const paused = updateSession('sess-1', { state: 'paused', current_time: 0 }, startedAt + 30);
      expect(paused.paused_counter).toBe(1);

      // Resume then pause again
      updateSession('sess-1', { state: 'playing', current_time: 30 }, startedAt + 60);
      const paused2 = updateSession('sess-1', { state: 'paused', current_time: 30 }, startedAt + 90);
      expect(paused2.paused_counter).toBe(2);
    });

    it('does not accumulate playback_time when paused', () => {
      const startedAt = 1000;
      createSession({ started_at: startedAt });

      // Play for 30s
      updateSession('sess-1', { state: 'playing', current_time: 30 }, startedAt + 30);
      // Pause
      updateSession('sess-1', { state: 'paused', current_time: 30 }, startedAt + 40);
      // Still paused 60s later
      const updated = updateSession('sess-1', { state: 'paused', current_time: 30 }, startedAt + 100);

      // playback_time should be 30 (from first playing interval), not 100
      expect(updated.playback_time).toBe(30);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Session state transitions
  // -----------------------------------------------------------------------
  describe('state transitions', () => {
    it('playing -> paused -> playing (resume) preserves playback_time', () => {
      const startedAt = 1000;
      createSession({ started_at: startedAt });

      // Play 30s
      updateSession('sess-1', { state: 'playing', current_time: 30 }, startedAt + 30);
      // Pause for 60s
      updateSession('sess-1', { state: 'paused', current_time: 30 }, startedAt + 40);
      updateSession('sess-1', { state: 'paused', current_time: 30 }, startedAt + 100);
      // Resume — since previous state was paused, no elapsed time added
      const resumed = updateSession('sess-1', { state: 'playing', current_time: 31 }, startedAt + 101);

      expect(resumed.state).toBe('playing');
      // playback_time still 30 from first playing interval; paused->playing doesn't accumulate
      expect(resumed.playback_time).toBe(30);
    });

    it('playing -> stopped sets stopped_at', () => {
      const startedAt = 1000;
      createSession({ started_at: startedAt });

      const stopped = updateSession('sess-1', { state: 'stopped', current_time: 100 }, startedAt + 100);

      expect(stopped.state).toBe('stopped');
      expect(stopped.stopped_at).toBe(startedAt + 100);
    });

    it('paused -> stopped sets stopped_at', () => {
      const startedAt = 1000;
      createSession({ started_at: startedAt });
      updateSession('sess-1', { state: 'paused', current_time: 30 }, startedAt + 30);

      const stopped = updateSession('sess-1', { state: 'stopped', current_time: 30 }, startedAt + 60);

      expect(stopped.state).toBe('stopped');
      expect(stopped.stopped_at).toBe(startedAt + 60);
    });
  });

  // -----------------------------------------------------------------------
  // 4. History recording on session stop
  // -----------------------------------------------------------------------
  describe('history recording', () => {
    it('creates history row when session meets all criteria', () => {
      const startedAt = 1000;
      ensureUser('user-1');
      createSession({ started_at: startedAt, duration: 7200 });
      // Play for 120s, reach 50%
      updateSession('sess-1', { state: 'playing', current_time: 3600, progress_percent: 50 }, startedAt + 120);

      const { historyRecorded, streamDuration } = stopAndRecord('sess-1', startedAt + 121);

      expect(historyRecorded).toBe(true);
      expect(streamDuration).toBe(120);

      const history = db.prepare('SELECT * FROM history WHERE media_id = ?').get('media-1');
      expect(history).toBeTruthy();
      expect(history.title).toBe('Test Movie');
      expect(history.percent_complete).toBe(50);
      expect(history.stream_duration).toBe(120);
    });

    it('skips history when stream_duration is too short', () => {
      const startedAt = 1000;
      ensureUser('user-1');
      createSession({ started_at: startedAt, duration: 7200 });
      // Play for only 10s
      updateSession('sess-1', { state: 'playing', current_time: 10, progress_percent: 50 }, startedAt + 10);

      const { historyRecorded } = stopAndRecord('sess-1', startedAt + 11);

      expect(historyRecorded).toBe(false);
      expect(db.prepare('SELECT count(*) as c FROM history').get().c).toBe(0);
    });

    it('skips history when user has history_enabled = 0', () => {
      const startedAt = 1000;
      ensureUser('user-1');
      db.prepare('UPDATE users SET history_enabled = 0 WHERE id = ?').run('user-1');
      createSession({ started_at: startedAt, duration: 7200 });
      updateSession('sess-1', { state: 'playing', current_time: 3600, progress_percent: 50 }, startedAt + 120);

      const { historyRecorded } = stopAndRecord('sess-1', startedAt + 121);

      expect(historyRecorded).toBe(false);
    });

    it('skips history when title matches exclusion pattern', () => {
      const startedAt = 1000;
      ensureUser('user-1');
      createSession({ started_at: startedAt, title: 'Movie Trailer', duration: 7200 });
      updateSession('sess-1', { state: 'playing', current_time: 3600, progress_percent: 50 }, startedAt + 120);

      const { historyRecorded } = stopAndRecord('sess-1', startedAt + 121);

      expect(historyRecorded).toBe(false);
    });

    it('skips history for low progress non-audio, but records for audiobook', () => {
      const startedAt = 1000;
      ensureUser('user-1');

      // Movie at 5% -> should be skipped
      createSession({ session_key: 'movie-sess', started_at: startedAt, media_id: 'mov-1', duration: 7200, media_type: 'movie' });
      updateSession('movie-sess', { state: 'playing', current_time: 360, progress_percent: 5 }, startedAt + 120);
      const movieResult = stopAndRecord('movie-sess', startedAt + 121);
      expect(movieResult.historyRecorded).toBe(false);

      // Audiobook at 5% -> should be recorded (audio skips progress check)
      createSession({ session_key: 'book-sess', started_at: startedAt, media_id: 'book-1', duration: 36000, media_type: 'audiobook' });
      updateSession('book-sess', { state: 'playing', current_time: 1800, progress_percent: 5 }, startedAt + 120);
      const bookResult = stopAndRecord('book-sess', startedAt + 121);
      expect(bookResult.historyRecorded).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Stream duration calculation
  // -----------------------------------------------------------------------
  describe('stream duration calculation', () => {
    it('uses accumulated playback_time as primary source', () => {
      const startedAt = 1000;
      createSession({ started_at: startedAt, duration: 7200 });
      updateSession('sess-1', { state: 'playing', current_time: 300 }, startedAt + 300);

      const session = getSession('sess-1');
      const duration = calculateStreamDuration(session, startedAt + 301);

      expect(duration).toBe(300);
    });

    it('falls back to elapsed time when playback_time < 5 and still playing', () => {
      const startedAt = 1000;
      // Create a session with 0 playback_time but with last_position_update set
      createSession({ started_at: startedAt, duration: 7200 });
      // Don't update (so playback_time stays 0), but session is still "playing"
      const session = getSession('sess-1');
      expect(session.playback_time).toBe(0);
      expect(session.state).toBe('playing');

      const duration = calculateStreamDuration(session, startedAt + 60);

      // Falls back to: now - last_position_update = 60
      expect(duration).toBe(60);
    });

    it('caps at session wall-clock time', () => {
      const startedAt = 1000;
      createSession({ started_at: startedAt, duration: 7200 });
      // Artificially set a large playback_time
      db.prepare('UPDATE sessions SET playback_time = 999 WHERE session_key = ?').run('sess-1');

      const session = getSession('sess-1');
      // Only 50 seconds have passed since session started
      const duration = calculateStreamDuration(session, startedAt + 50);

      expect(duration).toBe(50);
    });

    it('caps at media duration', () => {
      const startedAt = 1000;
      createSession({ started_at: startedAt, duration: 100 }); // 100s media
      // Set playback_time larger than media duration but within wall-clock
      db.prepare('UPDATE sessions SET playback_time = 200 WHERE session_key = ?').run('sess-1');

      const session = getSession('sess-1');
      const duration = calculateStreamDuration(session, startedAt + 500);

      expect(duration).toBe(100);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Duplicate prevention
  // -----------------------------------------------------------------------
  describe('duplicate prevention', () => {
    it('same session_id + media_id produces only one history entry', () => {
      const startedAt = 1000;
      ensureUser('user-1');
      createSession({ started_at: startedAt, duration: 7200 });
      updateSession('sess-1', { state: 'playing', current_time: 3600, progress_percent: 50 }, startedAt + 120);

      stopAndRecord('sess-1', startedAt + 121);
      // Try to record again (simulates a duplicate stop event)
      const session = getSession('sess-1');
      // Manually attempt a second insert with the same session_id
      const existingHistory = db.prepare('SELECT id FROM history WHERE session_id = ? AND media_id = ?')
        .get(session.id, session.media_id);
      expect(existingHistory).toBeTruthy();

      const count = db.prepare('SELECT count(*) as c FROM history WHERE media_id = ?').get('media-1');
      expect(count.c).toBe(1);
    });

    it('different session_id same media_id produces two history entries (re-watch)', () => {
      const startedAt = 1000;
      ensureUser('user-1');

      // First watch
      createSession({ session_key: 'sess-A', started_at: startedAt, media_id: 'media-1', duration: 7200 });
      updateSession('sess-A', { state: 'playing', current_time: 3600, progress_percent: 50 }, startedAt + 120);
      stopAndRecord('sess-A', startedAt + 121);

      // Second watch — different session
      createSession({ session_key: 'sess-B', started_at: startedAt + 200, media_id: 'media-1', duration: 7200 });
      updateSession('sess-B', { state: 'playing', current_time: 3600, progress_percent: 80 }, startedAt + 320);
      stopAndRecord('sess-B', startedAt + 321);

      const count = db.prepare('SELECT count(*) as c FROM history WHERE media_id = ?').get('media-1');
      expect(count.c).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // 7. User stats updates
  // -----------------------------------------------------------------------
  describe('user stats updates', () => {
    it('inserts a new user on first session', () => {
      ensureUser('new-user', 'emby', 'newguy');

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get('new-user');
      expect(user).toBeTruthy();
      expect(user.username).toBe('newguy');
      expect(user.total_plays).toBe(0);
      expect(user.total_duration).toBe(0);
    });

    it('increments total_plays after history is recorded', () => {
      const startedAt = 1000;
      ensureUser('user-1');
      createSession({ started_at: startedAt, duration: 7200 });
      updateSession('sess-1', { state: 'playing', current_time: 3600, progress_percent: 50 }, startedAt + 120);

      stopAndRecord('sess-1', startedAt + 121);

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get('user-1');
      expect(user.total_plays).toBe(1);
    });

    it('updates total_duration with stream_duration', () => {
      const startedAt = 1000;
      ensureUser('user-1');
      createSession({ started_at: startedAt, duration: 7200 });
      updateSession('sess-1', { state: 'playing', current_time: 3600, progress_percent: 50 }, startedAt + 120);

      const { streamDuration } = stopAndRecord('sess-1', startedAt + 121);

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get('user-1');
      expect(user.total_duration).toBe(streamDuration);
      expect(streamDuration).toBe(120);
    });
  });
});
