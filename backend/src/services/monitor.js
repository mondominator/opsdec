import cron from 'node-cron';
import EmbyService from './emby.js';
import PlexService from './plex.js';
import AudiobookshelfService from './audiobookshelf.js';
import db from '../database/init.js';
import { broadcast } from '../index.js';
import geolocation from './geolocation.js';

let embyService = null;
let plexService = null;
let audiobookshelfService = null;
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
      activity.city = null;
      activity.region = null;
      activity.country = null;
    }
  } else {
    activity.city = null;
    activity.region = null;
    activity.country = null;
  }

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

      // Calculate stream duration: how long they actually watched this specific item
      const streamDuration = stopNow - existing.started_at;

      // Add old session to history if it meets criteria
      if (shouldAddToHistory(existing.title, existing.duration, existing.progress_percent, existing.user_id, streamDuration, existing.media_type)) {
        try {
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
            ip_address = ?,
            location = ?,
            city = ?,
            region = ?,
            country = ?,
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
        activity.ipAddress || null,
        activity.location || null,
        activity.city || null,
        activity.region || null,
        activity.country || null,
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
        current_time, bitrate, transcoding, video_codec, audio_codec, container, resolution,
        ip_address, location, city, region, country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      console.log(`⏹️  Session stopped: ${session.username} - ${session.title} (${session.progress_percent}% / ${session.duration}s)`);

      // Get session data to calculate stream duration
      const sessionData = db.prepare('SELECT * FROM sessions WHERE session_key = ?').get(session.session_key);

      // Calculate stream duration: how long they actually watched this specific item
      const streamDuration = now - sessionData.started_at;

      // Add to history if it meets criteria
      if (shouldAddToHistory(session.title, session.duration, session.progress_percent, session.user_id, streamDuration, sessionData.media_type)) {
        try {
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
            console.log(`   Skipped history: Already added for this media (${session.title})`);
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

  // Set up Socket.io for Audiobookshelf if available
  if (audiobookshelfService) {
    console.log('🔌 Setting up Audiobookshelf Socket.io for real-time updates...');

    // Connect to Socket.io
    audiobookshelfService.connectSocket();

    // Register event handler for session updates
    audiobookshelfService.onSocketEvent((event) => {
      if (event.type === 'session_update' || event.type === 'session_started' ||
          event.type === 'session_stopped' || event.type === 'session_progress') {
        console.log('📨 Audiobookshelf Socket.io event triggered immediate session check');
        // Immediately check activity when we get a Socket.io event
        checkActivity(services);
      }
    });
  }

  // Initial check
  checkActivity(services);

  // Schedule periodic checks and store the cron job
  // This serves as a fallback when WebSocket disconnects or misses events
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

  // Disconnect WebSocket connections
  if (plexService && plexService.disconnectWebSocket) {
    plexService.disconnectWebSocket();
    console.log('   Disconnected Plex WebSocket');
  }

  if (embyService && embyService.disconnectWebSocket) {
    embyService.disconnectWebSocket();
    console.log('   Disconnected Emby WebSocket');
  }

  if (audiobookshelfService && audiobookshelfService.disconnectSocket) {
    audiobookshelfService.disconnectSocket();
    console.log('   Disconnected Audiobookshelf Socket.io');
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
