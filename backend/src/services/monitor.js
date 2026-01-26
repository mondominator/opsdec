import cron from 'node-cron';
import EmbyService from './emby.js';
import PlexService from './plex.js';
import AudiobookshelfService from './audiobookshelf.js';
import SapphoService from './sappho.js';
import JellyfinService from './jellyfin.js';
import db from '../database/init.js';
import { broadcast } from '../index.js';
import geolocation from './geolocation.js';

let embyService = null;
let plexService = null;
let audiobookshelfService = null;
let sapphoService = null;
let jellyfinService = null;
let lastActiveSessions = new Map();
let cronJob = null;

// Helper function to get history filter settings
function getHistorySettings() {
  try {
    const minDuration = db.prepare('SELECT value FROM settings WHERE key = ?').get('history_min_duration');
    const minPercent = db.prepare('SELECT value FROM settings WHERE key = ?').get('history_min_percent');
    const exclusionPatterns = db.prepare('SELECT value FROM settings WHERE key = ?').get('history_exclusion_patterns');
    const groupSuccessive = db.prepare('SELECT value FROM settings WHERE key = ?').get('history_group_successive');

    return {
      minDuration: minDuration ? parseInt(minDuration.value) : 30,
      minPercent: minPercent ? parseInt(minPercent.value) : 10,
      exclusionPatterns: exclusionPatterns ? exclusionPatterns.value.split(',').map(p => p.trim().toLowerCase()) : ['theme'],
      groupSuccessive: groupSuccessive ? parseInt(groupSuccessive.value) === 1 : true
    };
  } catch (error) {
    console.error('Error loading history settings:', error.message);
    return {
      minDuration: 30,
      minPercent: 10,
      exclusionPatterns: ['theme'],
      groupSuccessive: true
    };
  }
}

// Helper function to determine if a session should be added to history
function shouldAddToHistory(title, duration, progressPercent, userId, streamDuration = 0, mediaType = null) {
  const settings = getHistorySettings();

  // Check if user has history enabled
  try {
    const user = db.prepare('SELECT history_enabled FROM users WHERE id = ?').get(userId);
    if (user && user.history_enabled === 0) {
      console.log(`   Skipped history: User has history disabled`);
      return false;
    }
  } catch (error) {
    console.error('Error checking user history setting:', error.message);
  }

  // Filter out excluded patterns (theme, preview, trailer, etc.)
  if (title) {
    const titleLower = title.toLowerCase();
    for (const pattern of settings.exclusionPatterns) {
      if (titleLower.includes(pattern)) {
        console.log(`   Skipped history: Title matches exclusion pattern "${pattern}"`);
        return false;
      }
    }
  }

  // Check minimum stream duration (actual time spent watching)
  // This prevents marking items as watched without actually streaming
  if (streamDuration < settings.minDuration) {
    console.log(`   Skipped history: Stream duration too short (${streamDuration}s < ${settings.minDuration}s)`);
    return false;
  }

  // Check minimum progress thresholds
  // Skip this check for audiobooks and tracks since they are consumed over many sessions
  const isAudioContent = mediaType && ['audiobook', 'track', 'book'].includes(mediaType);
  if (!isAudioContent && progressPercent < settings.minPercent) {
    console.log(`   Skipped history: Not watched enough (${progressPercent}% < ${settings.minPercent}%)`);
    return false;
  }

  return true;
}

export function initServices() {
  const services = [];

  // Auto-migrate environment variables to database on first run
  migrateEnvToDatabase();

  // First, try to load from database
  try {
    const dbServers = db.prepare('SELECT * FROM servers WHERE enabled = 1').all();

    for (const server of dbServers) {
      try {
        let service;
        if (server.type === 'emby') {
          service = new EmbyService(server.url, server.api_key);
          embyService = service;
          services.push({ name: server.name, service, type: 'emby', id: server.id });
          console.log(`✅ ${server.name} (Emby) initialized from database`);
        } else if (server.type === 'plex') {
          service = new PlexService(server.url, server.api_key);
          plexService = service;
          services.push({ name: server.name, service, type: 'plex', id: server.id });
          console.log(`✅ ${server.name} (Plex) initialized from database`);
        } else if (server.type === 'audiobookshelf') {
          service = new AudiobookshelfService(server.url, server.api_key);
          service.setDatabase(db); // Pass database reference for cleanup operations
          audiobookshelfService = service;
          services.push({ name: server.name, service, type: 'audiobookshelf', id: server.id });
          console.log(`✅ ${server.name} (Audiobookshelf) initialized from database`);
        } else if (server.type === 'sappho') {
          service = new SapphoService(server.url, server.api_key);
          sapphoService = service;
          services.push({ name: server.name, service, type: 'sappho', id: server.id });
          console.log(`✅ ${server.name} (Sappho) initialized from database`);
        } else if (server.type === 'jellyfin') {
          service = new JellyfinService(server.url, server.api_key);
          jellyfinService = service;
          services.push({ name: server.name, service, type: 'jellyfin', id: server.id });
          console.log(`✅ ${server.name} (Jellyfin) initialized from database`);
        }
      } catch (error) {
        console.error(`❌ Failed to initialize ${server.name}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Error loading servers from database:', error.message);
  }

  if (services.length === 0) {
    console.warn('⚠️  No media servers configured! Add servers via the Settings page.');
  }

  return services;
}

// Migrate environment variables to database on first run
function migrateEnvToDatabase() {
  try {
    const now = Math.floor(Date.now() / 1000);

    // Check and migrate Emby
    const embyUrl = process.env.EMBY_URL;
    const embyApiKey = process.env.EMBY_API_KEY;
    if (embyUrl && embyApiKey) {
      const existing = db.prepare('SELECT * FROM servers WHERE type = ? AND url = ?').get('emby', embyUrl);
      if (!existing) {
        const id = `emby-${Date.now()}`;
        db.prepare(`
          INSERT INTO servers (id, type, name, url, api_key, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, 'emby', 'Emby', embyUrl, embyApiKey, 1, now, now);
        console.log('📥 Migrated Emby from environment variables to database');
      }
    }

    // Check and migrate Plex
    const plexUrl = process.env.PLEX_URL;
    const plexToken = process.env.PLEX_TOKEN;
    if (plexUrl && plexToken) {
      const existing = db.prepare('SELECT * FROM servers WHERE type = ? AND url = ?').get('plex', plexUrl);
      if (!existing) {
        const id = `plex-${Date.now()}`;
        db.prepare(`
          INSERT INTO servers (id, type, name, url, api_key, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, 'plex', 'Plex', plexUrl, plexToken, 1, now, now);
        console.log('📥 Migrated Plex from environment variables to database');
      }
    }

    // Check and migrate Audiobookshelf
    const audiobookshelfUrl = process.env.AUDIOBOOKSHELF_URL;
    const audiobookshelfApiKey = process.env.AUDIOBOOKSHELF_API_KEY;
    if (audiobookshelfUrl && audiobookshelfApiKey) {
      const existing = db.prepare('SELECT * FROM servers WHERE type = ? AND url = ?').get('audiobookshelf', audiobookshelfUrl);
      if (!existing) {
        const id = `audiobookshelf-${Date.now()}`;
        db.prepare(`
          INSERT INTO servers (id, type, name, url, api_key, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, 'audiobookshelf', 'Audiobookshelf', audiobookshelfUrl, audiobookshelfApiKey, 1, now, now);
        console.log('📥 Migrated Audiobookshelf from environment variables to database');
      }
    }

    // Check and migrate Sappho
    const sapphoUrl = process.env.SAPHO_URL;
    const sapphoApiKey = process.env.SAPHO_API_KEY;
    if (sapphoUrl && sapphoApiKey) {
      const existing = db.prepare('SELECT * FROM servers WHERE type = ? AND url = ?').get('sappho', sapphoUrl);
      if (!existing) {
        const id = `sappho-${Date.now()}`;
        db.prepare(`
          INSERT INTO servers (id, type, name, url, api_key, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, 'sappho', 'Sappho', sapphoUrl, sapphoApiKey, 1, now, now);
        console.log('📥 Migrated Sappho from environment variables to database');
      }
    }

    // Check and migrate Jellyfin
    const jellyfinUrl = process.env.JELLYFIN_URL;
    const jellyfinApiKey = process.env.JELLYFIN_API_KEY;
    if (jellyfinUrl && jellyfinApiKey) {
      const existing = db.prepare('SELECT * FROM servers WHERE type = ? AND url = ?').get('jellyfin', jellyfinUrl);
      if (!existing) {
        const id = `jellyfin-${Date.now()}`;
        db.prepare(`
          INSERT INTO servers (id, type, name, url, api_key, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, 'jellyfin', 'Jellyfin', jellyfinUrl, jellyfinApiKey, 1, now, now);
        console.log('📥 Migrated Jellyfin from environment variables to database');
      }
    }
  } catch (error) {
    console.error('Error migrating environment variables to database:', error.message);
  }
}

async function updateSession(activity, serverType) {
  const now = Math.floor(Date.now() / 1000);

  // Lookup geolocation for IP address if available
  let geoData = null;
  if (activity.ipAddress) {
    try {
      geoData = await geolocation.lookup(activity.ipAddress);
      activity.city = geoData.city;
      activity.region = geoData.region;
      activity.country = geoData.country;
    } catch (error) {
      console.error('Error looking up geolocation:', error.message);
      // If geolocation fails and it's a LAN connection, set "Local Network"
      if (activity.location === 'lan') {
        activity.city = 'Local Network';
        activity.region = null;
        activity.country = null;
      } else {
        activity.city = null;
        activity.region = null;
        activity.country = null;
      }
    }
  } else {
    activity.city = null;
    activity.region = null;
    activity.country = null;
  }

  // Check if session exists
  let existing = db.prepare('SELECT * FROM sessions WHERE session_key = ?').get(activity.sessionKey);

  if (existing) {
    // If session was already stopped (e.g., paused timeout) AND media hasn't changed AND activity is stopped or paused, ignore further updates
    // (paused updates are just the client still reporting the session that we already stopped due to timeout)
    if (existing.state === 'stopped' && existing.stopped_at && existing.media_id === activity.mediaId && (activity.state === 'stopped' || activity.state === 'paused')) {
      console.log(`⏹️  Ignoring update for stopped session: ${existing.title}`);
      return;
    }

    // If session was stopped but now resumed with same media (playing or buffering), create a new session
    // Each viewing session will create its own history entry with a unique session_id
    // Note: Don't resume if state is 'paused' - that's just the client still reporting the stopped session
    if (existing.state === 'stopped' && existing.stopped_at && existing.media_id === activity.mediaId && (activity.state === 'playing' || activity.state === 'buffering')) {
      console.log(`▶️  Resuming stopped session as new session: ${existing.title}`);
      // History was already created when it stopped
      // Delete the old session row to allow reuse of session_key
      // (session_key has UNIQUE constraint, so we must delete before inserting)
      const oldSessionId = existing.id;
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(oldSessionId);
      console.log(`   Deleted old session row (id: ${oldSessionId}) to allow session_key reuse`);

      // Create a NEW session for the resumed viewing (don't reuse the old session row)
      // This ensures each viewing session gets its own session_id for proper history tracking
      const playbackTime = 0;
      const lastPositionUpdate = activity.state === 'playing' ? now : null;

      db.prepare(`
        INSERT INTO sessions (
          session_key, server_type, server_id, user_id, username, user_thumb,
          media_type, media_id, title, parent_title, grandparent_title,
          season_number, episode_number,
          year, thumb, art, started_at, state, progress_percent, duration,
          current_time, playback_time, last_position_update,
          bitrate, transcoding, video_codec, audio_codec, container, resolution,
          ip_address, location, city, region, country
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        activity.sessionKey,
        serverType,
        'default',
        activity.userId,
        activity.username,
        activity.userThumb || null,
        activity.mediaType,
        activity.mediaId,
        activity.title,
        activity.parentTitle || null,
        activity.grandparentTitle || null,
        activity.seasonNumber || null,
        activity.episodeNumber || null,
        activity.year || null,
        activity.thumb || null,
        activity.art || null,
        now,
        activity.state,
        activity.progressPercent || 0,
        activity.duration || 0,
        activity.currentTime || 0,
        playbackTime,
        lastPositionUpdate,
        activity.bitrate || null,
        activity.transcoding ? 1 : 0,
        activity.videoCodec || null,
        activity.audioCodec || null,
        activity.container || null,
        activity.resolution || null,
        activity.ipAddress || null,
        activity.location || null,
        activity.city || null,
        activity.region || null,
        activity.country || null
      );

      console.log(`📺 New session created for resumed viewing: ${activity.username} resumed ${activity.title}`);
      return;
    }
    // Check if media changed (new episode/movie in same session)
    else if (existing.media_id !== activity.mediaId) {
      // If session is already stopped, don't process media change - just create a new session
      // This prevents duplicate history entries when resuming after a stopped session
      if (existing.state === 'stopped' && existing.stopped_at) {
        console.log(`⏭️  Session already stopped, creating new session for new media: ${activity.title}`);

        // Delete the old stopped session to allow session_key reuse
        db.prepare(`DELETE FROM sessions WHERE id = ?`).run(existing.id);

        // Create new session (code will fall through to new session creation at bottom)
        // We need to force creating a new session, so we'll do it inline here
        const playbackTime = 0;
        const lastPositionUpdate = activity.state === 'playing' ? now : null;

        db.prepare(`
          INSERT INTO sessions (
            session_key, server_type, server_id, user_id, username, user_thumb,
            media_type, media_id, title, parent_title, grandparent_title,
            season_number, episode_number,
            year, thumb, art, started_at, state, progress_percent, duration,
            current_time, playback_time, last_position_update,
            bitrate, transcoding, video_codec, audio_codec, container, resolution,
            ip_address, location, city, region, country
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          activity.sessionKey,
          serverType,
          'default',
          activity.userId,
          activity.username,
          activity.userThumb || null,
          activity.mediaType,
          activity.mediaId,
          activity.title,
          activity.parentTitle,
          activity.grandparentTitle,
          activity.seasonNumber || null,
          activity.episodeNumber || null,
          activity.year,
          activity.thumb,
          activity.art,
          now,
          activity.state,
          activity.progressPercent,
          activity.duration,
          activity.currentTime || 0,
          playbackTime,
          lastPositionUpdate,
          activity.bitrate || null,
          activity.transcoding ? 1 : 0,
          activity.videoCodec || null,
          activity.audioCodec || null,
          activity.container || null,
          activity.resolution || null,
          activity.ipAddress || null,
          activity.location || null,
          activity.city || null,
          activity.region || null,
          activity.country || null
        );

        console.log(`📺 New session created: ${activity.username} watching ${activity.title} (${serverType})`);
        return;
      }

      // Media changed in an active session, stop old session and create new one
      console.log(`🔄 Media changed in session: ${existing.title} -> ${activity.title}`);

      // Stop the old session
      const stopNow = now;
      const oldSessionId = existing.id;

      // Calculate stream duration: use playback_time (actual watch time, not wall-clock time)
      let streamDuration = existing.playback_time || 0;

      // If playback_time is 0 or very small but we have last_position_update, calculate elapsed time
      if (streamDuration < 5 && existing.last_position_update && existing.state === 'playing') {
        streamDuration = stopNow - existing.last_position_update;
        console.log(`   📊 Calculated stream duration from elapsed time: ${streamDuration}s`);
      }

      // Sanity check: stream duration should never exceed the time since session started
      const maxSessionDuration = stopNow - existing.started_at;
      if (streamDuration > maxSessionDuration) {
        console.log(`   ⚠️ Stream duration (${streamDuration}s) exceeds session time (${maxSessionDuration}s), capping`);
        streamDuration = maxSessionDuration;
      }

      // Also cap at media duration if available
      if (existing.duration && streamDuration > existing.duration) {
        console.log(`   ⚠️ Stream duration (${streamDuration}s) exceeds media duration (${existing.duration}s), capping`);
        streamDuration = existing.duration;
      }

      // Mark old session as stopped (we'll delete it after adding to history)
      db.prepare(`
        UPDATE sessions
        SET state = 'stopped',
            stopped_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(stopNow, stopNow, oldSessionId);

      // Add old session to history if it meets criteria
      if (shouldAddToHistory(existing.title, existing.duration, existing.progress_percent, existing.user_id, streamDuration, existing.media_type)) {
        try {
          // Check for duplicate history entries
          // Use session_id as primary duplicate check - each session should only create ONE history entry
          const existingHistory = db.prepare(`
            SELECT id FROM history
            WHERE session_id = ? AND media_id = ?
          `).get(oldSessionId, existing.media_id);

          if (!existingHistory) {
            db.prepare(`
              INSERT INTO history (
                session_id, server_type, user_id, username,
                media_type, media_id, title, parent_title, grandparent_title,
                watched_at, duration, percent_complete, thumb, stream_duration,
                ip_address, city, region, country
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              oldSessionId,
              existing.server_type,
              existing.user_id,
              existing.username,
              existing.media_type,
              existing.media_id,
              existing.title,
              existing.parent_title,
              existing.grandparent_title,
              stopNow,
              existing.duration,
              existing.progress_percent,
              existing.thumb,
              streamDuration,
              existing.ip_address,
              existing.city,
              existing.region,
              existing.country
            );

            db.prepare(`
              UPDATE users
              SET total_plays = total_plays + 1,
                  total_duration = total_duration + ?
              WHERE id = ?
            `).run(streamDuration, existing.user_id);

            console.log(`📝 Added to history: ${existing.title} (${existing.progress_percent}%)`);
          } else {
            console.log(`   Skipped history: Duplicate detected for ${existing.title}`);
          }
        } catch (error) {
          console.error(`Error adding to history:`, error.message);
        }
      }

      // Delete the old session row to allow reuse of session_key
      // (session_key has UNIQUE constraint, so we must delete before inserting)
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(oldSessionId);
      console.log(`   Deleted old session row (id: ${oldSessionId}) to allow session_key reuse`);

      // Create a NEW session for the new media (don't reuse the old session row)
      // This ensures each media item gets its own session_id for proper history tracking
      const playbackTime = 0;
      const lastPositionUpdate = activity.state === 'playing' ? now : null;

      db.prepare(`
        INSERT INTO sessions (
          session_key, server_type, server_id, user_id, username, user_thumb,
          media_type, media_id, title, parent_title, grandparent_title,
          season_number, episode_number,
          year, thumb, art, started_at, state, progress_percent, duration,
          current_time, playback_time, last_position_update,
          bitrate, transcoding, video_codec, audio_codec, container, resolution,
          ip_address, location, city, region, country
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        activity.sessionKey,
        serverType,
        'default',
        activity.userId,
        activity.username,
        activity.userThumb || null,
        activity.mediaType,
        activity.mediaId,
        activity.title,
        activity.parentTitle,
        activity.grandparentTitle,
        activity.seasonNumber || null,
        activity.episodeNumber || null,
        activity.year,
        activity.thumb,
        activity.art,
        now,
        activity.state,
        activity.progressPercent,
        activity.duration,
        activity.currentTime || 0,
        playbackTime,
        lastPositionUpdate,
        activity.bitrate || null,
        activity.transcoding ? 1 : 0,
        activity.videoCodec || null,
        activity.audioCodec || null,
        activity.container || null,
        activity.resolution || null,
        activity.ipAddress || null,
        activity.location || null,
        activity.city || null,
        activity.region || null,
        activity.country || null
      );

      console.log(`📺 New session created: ${activity.username} now watching ${activity.title} (${serverType})`);
    } else {
      // Same media, just update progress and stream info
      // Calculate playback_time based on elapsed time while playing
      let playbackTime = existing.playback_time || 0;

      // If currently playing and was playing before, add elapsed time
      if (activity.state === 'playing' && existing.state === 'playing' && existing.last_position_update) {
        const elapsedSinceLastUpdate = now - existing.last_position_update;
        playbackTime += elapsedSinceLastUpdate;
      }

      db.prepare(`
        UPDATE sessions
        SET state = ?,
            progress_percent = ?,
            current_time = ?,
            playback_time = ?,
            last_position_update = CASE WHEN ? = 'playing' THEN ? ELSE last_position_update END,
            bitrate = ?,
            transcoding = ?,
            video_codec = ?,
            audio_codec = ?,
            container = ?,
            resolution = ?,
            updated_at = CASE WHEN ? != 'paused' THEN ? ELSE updated_at END,
            stopped_at = CASE WHEN ? = 'stopped' THEN ? ELSE stopped_at END,
            paused_counter = CASE WHEN ? = 'paused' AND state = 'playing' THEN paused_counter + 1 ELSE paused_counter END
        WHERE session_key = ?
      `).run(
        activity.state,
        activity.progressPercent,
        activity.currentTime || 0,
        playbackTime,
        activity.state,
        now,
        activity.bitrate || null,
        activity.transcoding ? 1 : 0,
        activity.videoCodec || null,
        activity.audioCodec || null,
        activity.container || null,
        activity.resolution || null,
        activity.state,
        now,
        activity.state,
        now,
        activity.state,
        activity.sessionKey
      );
    }
  } else {
    // Create new session
    // Start with 0 playback time, will accumulate as we get updates
    const playbackTime = 0;
    // Only set last_position_update if actually playing
    const lastPositionUpdate = activity.state === 'playing' ? now : null;

    db.prepare(`
      INSERT INTO sessions (
        session_key, server_type, server_id, user_id, username, user_thumb,
        media_type, media_id, title, parent_title, grandparent_title,
        season_number, episode_number,
        year, thumb, art, started_at, state, progress_percent, duration,
        current_time, playback_time, last_position_update,
        bitrate, transcoding, video_codec, audio_codec, container, resolution,
        ip_address, location, city, region, country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      activity.sessionKey,
      serverType,
      'default',
      activity.userId,
      activity.username,
      activity.userThumb || null,
      activity.mediaType,
      activity.mediaId,
      activity.title,
      activity.parentTitle,
      activity.grandparentTitle,
      activity.seasonNumber || null,
      activity.episodeNumber || null,
      activity.year,
      activity.thumb,
      activity.art,
      now,
      activity.state,
      activity.progressPercent,
      activity.duration,
      activity.currentTime || 0,
      playbackTime,
      lastPositionUpdate,
      activity.bitrate || null,
      activity.transcoding ? 1 : 0,
      activity.videoCodec || null,
      activity.audioCodec || null,
      activity.container || null,
      activity.resolution || null,
      activity.ipAddress || null,
      activity.location || null,
      activity.city || null,
      activity.region || null,
      activity.country || null
    );

    console.log(`📺 New session started: ${activity.username} watching ${activity.title} (${serverType})`);
  }

  // Update user stats
  updateUserStats(activity.userId, activity.username, serverType, activity.userThumb);
}

function updateUserStats(userId, username, serverType, userThumb = null) {
  const now = Math.floor(Date.now() / 1000);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET last_seen = ?,
          updated_at = ?,
          thumb = ?
      WHERE id = ?
    `).run(now, now, userThumb, userId);
  } else {
    db.prepare(`
      INSERT INTO users (id, server_type, username, last_seen, thumb)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, serverType, username, now, userThumb);
  }
}

// Import history from Audiobookshelf listening sessions API
async function importAudiobookshelfHistory(service, serverType) {
  try {
    const listeningSessions = await service.getListeningSessions();
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60); // Only import sessions from last 7 days
    let importedCount = 0;
    let skippedCount = 0;

    for (const session of listeningSessions) {
      if (!session || !session.id || !session.userId || !session.libraryItemId) {
        continue;
      }

      // Only import sessions from the last 7 days
      const sessionTime = session.updatedAt ? Math.floor(session.updatedAt / 1000) : 0;
      if (sessionTime < sevenDaysAgo) {
        skippedCount++;
        continue;
      }

      // Check if we've already imported this session
      // Use media_id, user_id, and session updatedAt timestamp for deduplication
      const existingHistory = db.prepare(`
        SELECT id FROM history
        WHERE media_id = ? AND user_id = ? AND server_type = ? AND watched_at = ?
      `).get(session.libraryItemId, session.userId, serverType, sessionTime);

      if (existingHistory) {
        // Already imported this session
        continue;
      }

      // Extract data from listening session
      const metadata = session.mediaMetadata || {};
      const title = metadata.title || session.displayTitle || 'Unknown Title';
      const seriesName = metadata.series?.[0]?.name || null;

      // Audiobookshelf API returns durations in seconds
      // But validate in case they're in milliseconds (> 10 days would be unusual)
      let duration = session.duration || 0;
      let currentTime = session.currentTime || 0;
      let streamDuration = session.timeListening || 0;

      // If values seem too large (> 864000 seconds = 10 days), assume milliseconds
      if (duration > 864000) {
        console.log(`⚠️ Audiobookshelf: Large duration detected (${duration}), assuming milliseconds - converting to seconds`);
        duration = Math.round(duration / 1000);
        currentTime = Math.round(currentTime / 1000);
        streamDuration = Math.round(streamDuration / 1000);
      }

      const percentComplete = duration ? Math.round((currentTime / duration) * 100) : 0;

      // Check if it should be added to history
      if (!shouldAddToHistory(
        title,
        duration,
        percentComplete,
        session.userId,
        streamDuration,
        'audiobook'
      )) {
        continue;
      }

      // Add to history
      try {
        // Ensure user exists in database BEFORE inserting history
        console.log(`Creating/updating user ${session.userId} (${session.username}) for Audiobookshelf`);
        updateUserStats(session.userId, session.username, serverType, null);

        // Verify user exists
        const userCheck = db.prepare('SELECT id FROM users WHERE id = ?').get(session.userId);
        if (!userCheck) {
          console.error(`Failed to create user ${session.userId} - skipping history import for this session`);
          continue;
        }

        const thumb = session.libraryItemId ? `${service.baseUrl}/api/items/${session.libraryItemId}/cover` : null;

        db.prepare(`
          INSERT INTO history (
            session_id, server_type, user_id, username,
            media_type, media_id, title, parent_title, grandparent_title,
            watched_at, duration, percent_complete, thumb, stream_duration,
            ip_address, city, region, country
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          null, // session_id - Audiobookshelf sessions aren't in the sessions table
          serverType,
          session.userId,
          session.username,
          'audiobook',
          session.libraryItemId,
          title,
          seriesName,
          null, // grandparent_title
          sessionTime,
          duration,
          percentComplete,
          thumb,
          streamDuration,
          null, // ip_address
          null, // city
          null, // region
          null  // country
        );

        // Update user play count
        db.prepare(`
          UPDATE users
          SET total_plays = total_plays + 1,
              total_duration = total_duration + ?
          WHERE id = ?
        `).run(streamDuration, session.userId);

        importedCount++;
        console.log(`📚 Imported Audiobookshelf history: ${title} (${percentComplete}% - ${Math.floor(streamDuration / 60)}m)`);
      } catch (error) {
        console.error(`Error importing Audiobookshelf history for session ${session.id}:`, error.message, `User: ${session.userId} (${session.username})`);
      }
    }

    if (importedCount > 0 || skippedCount > 0) {
      console.log(`✅ Audiobookshelf history import: ${importedCount} new sessions imported, ${skippedCount} old sessions skipped (older than 7 days)`);
    }
  } catch (error) {
    console.error('Error in importAudiobookshelfHistory:', error.message);
  }
}

function stopInactiveSessions(activeSessionKeys) {
  const now = Math.floor(Date.now() / 1000);
  const STALE_SESSION_TIMEOUT = 60; // 60 seconds without updates = stale
  const PAUSED_SESSION_TIMEOUT = 30; // 30 seconds paused = auto-stop

  // First, clean up stale paused sessions (paused for more than 30 seconds)
  // Note: Audiobookshelf is excluded because it handles its own history import
  // Sappho, Plex, and Emby sessions are included for proper history tracking
  console.log(`🔍 Paused session check: now=${now}, timeout=${PAUSED_SESSION_TIMEOUT}`);

  const stalePausedSessions = db.prepare(`
    SELECT session_key, user_id, username, title, progress_percent, duration, server_type, updated_at, (? - updated_at) as age
    FROM sessions
    WHERE state = 'paused'
      AND server_type NOT IN ('audiobookshelf')
      AND (? - updated_at) > ?
  `).all(now, now, PAUSED_SESSION_TIMEOUT);

  console.log(`🔍 Checking for stale paused sessions: found ${stalePausedSessions.length}`);
  if (stalePausedSessions.length > 0) {
    console.log(`   Sessions:`, stalePausedSessions.map(s => `${s.title} (${s.age}s old)`).join(', '));
  }

  for (const session of stalePausedSessions) {
    // Mark as stopped
    db.prepare(`
      UPDATE sessions
      SET state = 'stopped',
          stopped_at = ?,
          updated_at = ?
      WHERE session_key = ?
    `).run(now, now, session.session_key);

    console.log(`⏸️  Paused session timeout: ${session.username} - ${session.title} (${session.progress_percent}% / ${session.duration}s)`);

    // Get session data to calculate stream duration
    const sessionData = db.prepare('SELECT * FROM sessions WHERE session_key = ?').get(session.session_key);

    // Calculate stream duration with sanity checks
    let streamDuration = sessionData.playback_time || 0;
    const now = Math.floor(Date.now() / 1000);

    // If playback_time is very small but we have timing info, calculate from elapsed time
    if (streamDuration < 5 && sessionData.last_position_update && sessionData.state === 'playing') {
      streamDuration = now - sessionData.last_position_update;
    }

    // Cap at session duration and media duration
    const maxSessionDuration = now - sessionData.started_at;
    if (streamDuration > maxSessionDuration) {
      streamDuration = maxSessionDuration;
    }
    if (sessionData.duration && streamDuration > sessionData.duration) {
      streamDuration = sessionData.duration;
    }

    // Add to history if it meets criteria
    if (shouldAddToHistory(session.title, session.duration, session.progress_percent, session.user_id, streamDuration, sessionData.media_type)) {
      try {
        // Check for duplicate history entries
        // Use session_id as primary duplicate check - each session should only create ONE history entry
        const existingHistory = db.prepare(`
          SELECT id FROM history
          WHERE session_id = ? AND media_id = ?
        `).get(sessionData.id, sessionData.media_id);

        if (!existingHistory) {
          db.prepare(`
            INSERT INTO history (
              session_id, server_type, user_id, username,
              media_type, media_id, title, parent_title, grandparent_title,
              watched_at, duration, percent_complete, thumb, stream_duration,
              ip_address, city, region, country
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            sessionData.id,
            sessionData.server_type,
            sessionData.user_id,
            sessionData.username,
            sessionData.media_type,
            sessionData.media_id,
            sessionData.title,
            sessionData.parent_title,
            sessionData.grandparent_title,
            now,
            sessionData.duration,
            session.progress_percent,
            sessionData.thumb,
            streamDuration,
            sessionData.ip_address,
            sessionData.city,
            sessionData.region,
            sessionData.country
          );

          db.prepare(`
            UPDATE users
            SET total_plays = total_plays + 1,
                total_duration = total_duration + ?
            WHERE id = ?
          `).run(streamDuration, session.user_id);

          console.log(`   📝 Added to history: ${session.title}`);
        }
      } catch (error) {
        console.error(`   Error adding to history: ${error.message}`);
      }
    }
  }

  // Find sessions that are no longer active
  // Exclude Audiobookshelf sessions - they will be handled by importAudiobookshelfHistory
  const activeSessions = db.prepare(`
    SELECT session_key, user_id, username, title, progress_percent, duration, server_type, updated_at
    FROM sessions
    WHERE state != 'stopped'
  `).all();

  // For Sappho, use a 60-second stale timeout before marking as stopped
  // This handles intermittent API failures where /api/sessions temporarily returns no data
  const SAPPHO_STALE_TIMEOUT = 60;

  for (const session of activeSessions) {
    // Skip Audiobookshelf sessions - they handle their own cleanup via history import
    // Sappho sessions are included in the normal cleanup flow
    if (session.server_type === 'audiobookshelf') {
      continue;
    }

    if (!activeSessionKeys.has(session.session_key)) {
      // For Sappho: only stop if session hasn't been updated for 60+ seconds
      // This prevents false stops due to intermittent API failures
      if (session.server_type === 'sappho') {
        const timeSinceUpdate = now - session.updated_at;
        if (timeSinceUpdate < SAPPHO_STALE_TIMEOUT) {
          console.log(`⏸️  Sappho session temporarily missing from API, waiting... (${timeSinceUpdate}s / ${SAPPHO_STALE_TIMEOUT}s): ${session.title}`);
          continue; // Don't stop yet, wait for grace period
        }
      }

      // Session is no longer active, mark as stopped
      db.prepare(`
        UPDATE sessions
        SET state = 'stopped',
            stopped_at = ?,
            updated_at = ?
        WHERE session_key = ?
      `).run(now, now, session.session_key);

      console.log(`⏹️  Session stopped: ${session.username} - ${session.title} (${session.progress_percent}% / ${session.duration}s)`);

      // Get session data to calculate stream duration
      const sessionData = db.prepare('SELECT * FROM sessions WHERE session_key = ?').get(session.session_key);

      // Calculate stream duration with sanity checks
      let streamDuration = sessionData.playback_time || 0;
      const now = Math.floor(Date.now() / 1000);

      // If playback_time is very small but we have timing info, calculate from elapsed time
      if (streamDuration < 5 && sessionData.last_position_update && sessionData.state === 'playing') {
        streamDuration = now - sessionData.last_position_update;
      }

      // Cap at session duration and media duration
      const maxSessionDuration = now - sessionData.started_at;
      if (streamDuration > maxSessionDuration) {
        streamDuration = maxSessionDuration;
      }
      if (sessionData.duration && streamDuration > sessionData.duration) {
        streamDuration = sessionData.duration;
      }

      // Add to history if it meets criteria
      if (shouldAddToHistory(session.title, session.duration, session.progress_percent, session.user_id, streamDuration, sessionData.media_type)) {
        try {
          // Check for duplicate history entries
          // Use session_id as primary duplicate check - each session should only create ONE history entry
          const existingHistory = db.prepare(`
            SELECT id FROM history
            WHERE session_id = ? AND media_id = ?
          `).get(sessionData.id, sessionData.media_id);

          if (!existingHistory) {

            db.prepare(`
              INSERT INTO history (
                session_id, server_type, user_id, username,
                media_type, media_id, title, parent_title, grandparent_title,
                watched_at, duration, percent_complete, thumb, stream_duration,
                ip_address, city, region, country
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              sessionData.id,
              sessionData.server_type,
              sessionData.user_id,
              sessionData.username,
              sessionData.media_type,
              sessionData.media_id,
              sessionData.title,
              sessionData.parent_title,
              sessionData.grandparent_title,
              now,
              sessionData.duration,
              session.progress_percent,
              sessionData.thumb,
              streamDuration,
              sessionData.ip_address,
              sessionData.city,
              sessionData.region,
              sessionData.country
            );

            // Update user play count
            db.prepare(`
              UPDATE users
              SET total_plays = total_plays + 1,
                  total_duration = total_duration + ?
              WHERE id = ?
            `).run(streamDuration, session.user_id);

            console.log(`📝 Added to history: ${session.title} (${session.progress_percent}%)`);
          } else {
            console.log(`   Skipped history: Duplicate detected for ${session.title}`);
          }
        } catch (error) {
          console.error(`Error adding to history:`, error.message);
        }
      }
    }
  }
}

async function checkActivity(services) {
  try {
    const activeSessionKeys = new Set();

    // Check all configured services
    for (const { name, service, type } of services) {
      try {
        const activeStreams = await service.getActiveStreams();

        // Update or create sessions for active streams
        for (const activity of activeStreams) {
          activeSessionKeys.add(activity.sessionKey);
          await updateSession(activity, type);
        }
      } catch (error) {
        console.error(`Error checking ${name} activity:`, error.message);
      }
    }

    // Stop sessions that are no longer active
    stopInactiveSessions(activeSessionKeys);

    // Get current active sessions for broadcast
    const currentSessions = db.prepare(`
      SELECT * FROM sessions
      WHERE state IN ('playing', 'paused', 'buffering')
      ORDER BY started_at DESC
    `).all();

    // Broadcast to WebSocket clients
    broadcast({
      type: 'activity',
      data: currentSessions,
    });

    lastActiveSessions = activeSessionKeys;
  } catch (error) {
    console.error('Error checking activity:', error.message);
  }
}

// Separate function to import Audiobookshelf history on its own schedule
async function checkAudiobookshelfHistory(services) {
  try {
    for (const { name, service, type } of services) {
      if (type === 'audiobookshelf' && service.getListeningSessions) {
        try {
          await importAudiobookshelfHistory(service, type);
        } catch (error) {
          console.error(`Error importing Audiobookshelf history:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error('Error in checkAudiobookshelfHistory:', error.message);
  }
}

export function startActivityMonitor() {
  const services = initServices();

  if (services.length === 0) {
    console.log('⏸️  Activity monitoring disabled (no servers configured)');
    console.log('   Add servers via the Settings page to start monitoring');
    return;
  }

  const pollInterval = parseInt(process.env.POLL_INTERVAL || '30', 10);
  console.log(`🔄 Starting activity monitor (polling every ${pollInterval}s)...`);
  console.log(`   Monitoring: ${services.map(s => s.name).join(', ')}`);

  // Set up WebSocket for Plex if available
  if (plexService) {
    console.log('🔌 Setting up Plex WebSocket for real-time updates...');

    // Connect to WebSocket
    plexService.connectWebSocket();

    // Register event handler for session updates
    plexService.onWebSocketEvent((event) => {
      if (event.type === 'session_update' || event.type === 'session_stopped') {
        console.log('📨 Plex WebSocket event triggered immediate session check');
        // Immediately check activity when we get a WebSocket event
        checkActivity(services);
      }
    });
  }

  // Set up WebSocket for Emby if available
  if (embyService) {
    console.log('🔌 Setting up Emby WebSocket for real-time updates...');

    // Connect to WebSocket
    embyService.connectWebSocket();

    // Register event handler for session updates
    embyService.onWebSocketEvent((event) => {
      if (event.type === 'session_update' || event.type === 'session_started' ||
          event.type === 'session_stopped' || event.type === 'session_ended' ||
          event.type === 'session_progress') {
        console.log('📨 Emby WebSocket event triggered immediate session check');
        // Immediately check activity when we get a WebSocket event
        checkActivity(services);
      }
    });
  }

  // Set up WebSocket for Jellyfin if available
  if (jellyfinService) {
    console.log('🔌 Setting up Jellyfin WebSocket for real-time updates...');

    // Connect to WebSocket
    jellyfinService.connectWebSocket();

    // Register event handler for session updates
    jellyfinService.onWebSocketEvent((event) => {
      if (event.type === 'session_update' || event.type === 'session_started' ||
          event.type === 'session_stopped' || event.type === 'session_ended' ||
          event.type === 'session_progress') {
        console.log('📨 Jellyfin WebSocket event triggered immediate session check');
        // Immediately check activity when we get a WebSocket event
        checkActivity(services);
      }
    });
  }

  // Set up WebSocket for Sappho if available
  if (sapphoService) {
    console.log('🔌 Setting up Sappho WebSocket for real-time updates...');

    // Connect to WebSocket
    sapphoService.connectWebSocket();

    // Register event handler for session updates
    sapphoService.onWebSocketEvent(async (type, message) => {
      if (type === 'session.stop') {
        console.log('📨 Sappho WebSocket: session.stop event - processing immediately');

        // Handle stopped session immediately
        const session = message.session;
        console.log(`   🔍 Session ID from message: ${session?.sessionId}`);

        if (session && session.sessionId) {
          try {
            // Get the session from database
            const dbSession = db.prepare('SELECT * FROM sessions WHERE session_key = ?').get(session.sessionId);
            console.log(`   🔍 Found DB session: ${dbSession ? dbSession.title : 'null'}, state: ${dbSession?.state}`);

            if (dbSession && dbSession.state !== 'stopped') {
              const now = Math.floor(Date.now() / 1000);

              // Calculate actual playback time: time since session started while playing
              // If playback_time was accumulated, use it; otherwise calculate from elapsed time
              let streamDuration = dbSession.playback_time || 0;

              // If playback_time is 0 or very small but we have last_position_update, calculate elapsed time
              if (streamDuration < 5 && dbSession.last_position_update && dbSession.state === 'playing') {
                streamDuration = now - dbSession.last_position_update;
                console.log(`   📊 Calculated stream duration from elapsed time: ${streamDuration}s`);
              }

              // Sanity check: stream duration should never exceed the time since session started
              const maxDuration = now - dbSession.started_at;
              if (streamDuration > maxDuration) {
                console.log(`   ⚠️ Stream duration (${streamDuration}s) exceeds session time (${maxDuration}s), capping`);
                streamDuration = maxDuration;
              }

              // Also cap at audiobook duration if available (don't record more than 100% of content)
              if (dbSession.duration && streamDuration > dbSession.duration) {
                console.log(`   ⚠️ Stream duration (${streamDuration}s) exceeds media duration (${dbSession.duration}s), capping`);
                streamDuration = dbSession.duration;
              }

              // Mark session as stopped
              db.prepare(`
                UPDATE sessions
                SET state = 'stopped',
                    stopped_at = ?,
                    updated_at = ?,
                    playback_time = ?
                WHERE session_key = ?
              `).run(now, now, streamDuration, session.sessionId);

              console.log(`   🛑 Stopped session: ${dbSession.title} (${dbSession.username}) - ${streamDuration}s duration`);

              // Add to history if it meets criteria
              if (shouldAddToHistory(dbSession.title, dbSession.duration, dbSession.progress_percent, dbSession.user_id, streamDuration, dbSession.media_type)) {
                try {
                  // Check if already in history - use session_id first
                  let existingHistory = db.prepare(`
                    SELECT id FROM history WHERE session_id = ? AND media_id = ?
                  `).get(dbSession.id, dbSession.media_id);

                  // Also check for very recent entries (within 60 seconds) for same user/media
                  // This prevents duplicates when session.stop fires multiple times
                  if (!existingHistory) {
                    const recentDuplicate = db.prepare(`
                      SELECT id FROM history
                      WHERE user_id = ? AND media_id = ? AND watched_at > ?
                    `).get(dbSession.user_id, dbSession.media_id, now - 60);

                    if (recentDuplicate) {
                      console.log(`   Skipped history: Recent entry exists for same user/media (within 60s)`);
                      existingHistory = recentDuplicate;
                    }
                  }

                  if (!existingHistory) {
                    db.prepare(`
                      INSERT INTO history (
                        session_id, server_type, user_id, username,
                        media_type, media_id, title, parent_title, grandparent_title,
                        watched_at, duration, percent_complete, thumb, stream_duration,
                        ip_address, city, region, country
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                      dbSession.id,
                      dbSession.server_type,
                      dbSession.user_id,
                      dbSession.username,
                      dbSession.media_type,
                      dbSession.media_id,
                      dbSession.title,
                      dbSession.parent_title,
                      dbSession.grandparent_title,
                      now,
                      dbSession.duration,
                      dbSession.progress_percent,
                      dbSession.thumb,
                      streamDuration,
                      dbSession.ip_address,
                      dbSession.city,
                      dbSession.region,
                      dbSession.country
                    );

                    // Update user stats
                    db.prepare(`
                      UPDATE users
                      SET total_plays = total_plays + 1,
                          total_duration = total_duration + ?
                      WHERE id = ?
                    `).run(streamDuration, dbSession.user_id);

                    console.log(`   ✅ Added to history via WebSocket: ${dbSession.title} (${dbSession.progress_percent}%)`);
                  }
                } catch (historyError) {
                  console.error(`   ❌ Error adding to history: ${historyError.message}`);
                }
              }
            }
          } catch (error) {
            console.error(`Error processing Sappho session.stop event: ${error.message}`);
          }
        }

        // Also trigger a full check to update UI
        checkActivity(services);
      } else if (type === 'session.pause') {
        console.log('📨 Sappho WebSocket: session.pause event - marking session as paused');

        const session = message.session;
        if (session && session.sessionId) {
          // Directly update session state to paused so timeout logic works
          const dbSession = db.prepare('SELECT * FROM sessions WHERE session_key = ?').get(session.sessionId);
          if (dbSession && dbSession.state === 'playing') {
            const now = Math.floor(Date.now() / 1000);
            db.prepare(`
              UPDATE sessions
              SET state = 'paused',
                  updated_at = ?
              WHERE session_key = ?
            `).run(now, session.sessionId);
            console.log(`   ⏸️ Marked session as paused: ${dbSession.title}`);
          }
        }

        // Trigger check to update UI
        checkActivity(services);
      } else if (type === 'session.start' || type === 'session.update') {
        console.log(`📨 Sappho WebSocket: ${type} event - updating session`);
        // For other events, just trigger the normal check
        checkActivity(services);
      }
    });
  }

  // For Audiobookshelf, import history from API every 5 minutes
  // Active streams are checked every minute (same as other servers)
  if (audiobookshelfService) {
    console.log('📚 Setting up Audiobookshelf history import (every 5 minutes)...');

    // Initial import
    checkAudiobookshelfHistory(services);

    // Schedule periodic history imports every 5 minutes
    cron.schedule('*/5 * * * *', () => {
      console.log('🔄 Running scheduled Audiobookshelf history import...');
      checkAudiobookshelfHistory(services);
    });
  }

  // Initial check
  checkActivity(services);

  // Schedule periodic checks every 60 seconds for all services (including Audiobookshelf)
  // This allows us to see active Audiobookshelf streams in real-time
  // Store the cron job so we can stop it when restarting
  cronJob = cron.schedule('*/60 * * * * *', () => {
    checkActivity(services);
  });
}

export function restartMonitoring() {
  console.log('🔄 Restarting monitoring service...');

  // Stop existing cron job if running
  if (cronJob) {
    cronJob.stop();
    console.log('   Stopped existing monitoring');
  }

  // Disconnect WebSocket connections
  if (plexService && plexService.disconnectWebSocket) {
    plexService.disconnectWebSocket();
    console.log('   Disconnected Plex WebSocket');
  }

  if (embyService && embyService.disconnectWebSocket) {
    embyService.disconnectWebSocket();
    console.log('   Disconnected Emby WebSocket');
  }

  if (jellyfinService && jellyfinService.disconnectWebSocket) {
    jellyfinService.disconnectWebSocket();
    console.log('   Disconnected Jellyfin WebSocket');
  }

  if (sapphoService && sapphoService.disconnectWebSocket) {
    sapphoService.disconnectWebSocket();
    console.log('   Disconnected Sappho WebSocket');
  }

  // Note: Audiobookshelf doesn't use real-time connections - history is imported on a schedule

  // Clear existing services
  embyService = null;
  plexService = null;
  audiobookshelfService = null;
  sapphoService = null;
  jellyfinService = null;
  lastActiveSessions = new Map();

  // Restart monitoring
  startActivityMonitor();

  console.log('✅ Monitoring service restarted');
}

export { embyService, plexService, audiobookshelfService, sapphoService, jellyfinService };
