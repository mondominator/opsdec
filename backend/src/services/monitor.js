import cron from 'node-cron';
import EmbyService from './emby.js';
import PlexService from './plex.js';
import AudiobookshelfService from './audiobookshelf.js';
import db from '../database/init.js';
import { broadcast } from '../index.js';

let embyService = null;
let plexService = null;
let audiobookshelfService = null;
let lastActiveSessions = new Map();
let cronJob = null;

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
          audiobookshelfService = service;
          services.push({ name: server.name, service, type: 'audiobookshelf', id: server.id });
          console.log(`✅ ${server.name} (Audiobookshelf) initialized from database`);
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
  } catch (error) {
    console.error('Error migrating environment variables to database:', error.message);
  }
}

function updateSession(activity, serverType) {
  const now = Math.floor(Date.now() / 1000);

  // Check if session exists
  const existing = db.prepare('SELECT * FROM sessions WHERE session_key = ?').get(activity.sessionKey);

  if (existing) {
    // Check if media changed (new episode/movie in same session)
    if (existing.media_id !== activity.mediaId) {
      // Media changed, stop old session and create new one
      console.log(`🔄 Media changed in session: ${existing.title} -> ${activity.title}`);

      // Stop the old session
      const stopNow = now;
      const oldSessionId = existing.id;

      // Add old session to history if watched enough
      const watchedEnough = existing.progress_percent > 10 ||
                           (existing.duration && existing.progress_percent * existing.duration / 100 > 300);

      if (watchedEnough) {
        try {
          db.prepare(`
            INSERT INTO history (
              session_id, server_type, user_id, username,
              media_type, media_id, title, parent_title, grandparent_title,
              watched_at, duration, percent_complete, thumb
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            existing.thumb
          );

          db.prepare(`
            UPDATE users
            SET total_plays = total_plays + 1,
                total_duration = total_duration + ?
            WHERE id = ?
          `).run(Math.floor(existing.duration * existing.progress_percent / 100), existing.user_id);

          console.log(`📝 Added to history: ${existing.title} (${existing.progress_percent}%)`);
        } catch (error) {
          console.error(`Error adding to history:`, error.message);
        }
      }

      // Update the session with new media info
      db.prepare(`
        UPDATE sessions
        SET media_type = ?,
            media_id = ?,
            title = ?,
            parent_title = ?,
            grandparent_title = ?,
            season_number = ?,
            episode_number = ?,
            year = ?,
            thumb = ?,
            art = ?,
            started_at = ?,
            state = ?,
            progress_percent = ?,
            duration = ?,
            current_time = ?,
            bitrate = ?,
            transcoding = ?,
            video_codec = ?,
            audio_codec = ?,
            container = ?,
            resolution = ?,
            user_thumb = ?,
            updated_at = ?
        WHERE session_key = ?
      `).run(
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
        activity.bitrate || null,
        activity.transcoding ? 1 : 0,
        activity.videoCodec || null,
        activity.audioCodec || null,
        activity.container || null,
        activity.resolution || null,
        activity.userThumb || null,
        now,
        activity.sessionKey
      );

      console.log(`📺 Session updated: ${activity.username} now watching ${activity.title} (${serverType})`);
    } else {
      // Same media, just update progress and stream info
      db.prepare(`
        UPDATE sessions
        SET state = ?,
            progress_percent = ?,
            current_time = ?,
            bitrate = ?,
            transcoding = ?,
            video_codec = ?,
            audio_codec = ?,
            container = ?,
            resolution = ?,
            updated_at = ?,
            stopped_at = CASE WHEN ? = 'stopped' THEN ? ELSE stopped_at END,
            paused_counter = CASE WHEN ? = 'paused' AND state = 'playing' THEN paused_counter + 1 ELSE paused_counter END
        WHERE session_key = ?
      `).run(
        activity.state,
        activity.progressPercent,
        activity.currentTime || 0,
        activity.bitrate || null,
        activity.transcoding ? 1 : 0,
        activity.videoCodec || null,
        activity.audioCodec || null,
        activity.container || null,
        activity.resolution || null,
        now,
        activity.state,
        now,
        activity.state,
        activity.sessionKey
      );
    }
  } else {
    // Create new session
    db.prepare(`
      INSERT INTO sessions (
        session_key, server_type, server_id, user_id, username, user_thumb,
        media_type, media_id, title, parent_title, grandparent_title,
        season_number, episode_number,
        year, thumb, art, started_at, state, progress_percent, duration,
        current_time, bitrate, transcoding, video_codec, audio_codec, container, resolution
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      activity.bitrate || null,
      activity.transcoding ? 1 : 0,
      activity.videoCodec || null,
      activity.audioCodec || null,
      activity.container || null,
      activity.resolution || null
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

function stopInactiveSessions(activeSessionKeys) {
  const now = Math.floor(Date.now() / 1000);

  // Find sessions that are no longer active
  const activeSessions = db.prepare(`
    SELECT session_key, user_id, username, title, progress_percent, duration
    FROM sessions
    WHERE state != 'stopped'
  `).all();

  for (const session of activeSessions) {
    if (!activeSessionKeys.has(session.session_key)) {
      // Session is no longer active, mark as stopped
      db.prepare(`
        UPDATE sessions
        SET state = 'stopped',
            stopped_at = ?,
            updated_at = ?
        WHERE session_key = ?
      `).run(now, now, session.session_key);

      // Add to history if watched enough (>10% or >5 minutes)
      const watchedEnough = session.progress_percent > 10 ||
                           (session.duration && session.progress_percent * session.duration / 100 > 300);

      console.log(`⏹️  Session stopped: ${session.username} - ${session.title} (${session.progress_percent}% / ${session.duration}s)`);

      if (watchedEnough) {
        try {
          const sessionData = db.prepare('SELECT * FROM sessions WHERE session_key = ?').get(session.session_key);

          // Check if this media_id has already been added to history for this session
          const existingHistory = db.prepare(`
            SELECT id FROM history
            WHERE session_id = ? AND media_id = ?
          `).get(sessionData.id, sessionData.media_id);

          if (!existingHistory) {
            db.prepare(`
              INSERT INTO history (
                session_id, server_type, user_id, username,
                media_type, media_id, title, parent_title, grandparent_title,
                watched_at, duration, percent_complete, thumb
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
              sessionData.thumb
            );

            // Update user play count
            db.prepare(`
              UPDATE users
              SET total_plays = total_plays + 1,
                  total_duration = total_duration + ?
              WHERE id = ?
            `).run(Math.floor(sessionData.duration * session.progress_percent / 100), session.user_id);

            console.log(`📝 Added to history: ${session.title} (${session.progress_percent}%)`);
          } else {
            console.log(`   Skipped history: Already added for this media (${session.title})`);
          }
        } catch (error) {
          console.error(`Error adding to history:`, error.message);
        }
      } else {
        console.log(`   Skipped history: Not watched enough (${session.progress_percent}%)`);
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
          updateSession(activity, type);
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

  // Initial check
  checkActivity(services);

  // Schedule periodic checks and store the cron job
  cronJob = cron.schedule(`*/${pollInterval} * * * * *`, () => {
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

  // Clear existing services
  embyService = null;
  plexService = null;
  audiobookshelfService = null;
  lastActiveSessions = new Map();

  // Restart monitoring
  startActivityMonitor();

  console.log('✅ Monitoring service restarted');
}

export { embyService, plexService, audiobookshelfService };
