import axios from 'axios';
import https from 'https';
import { io } from 'socket.io-client';

class AudiobookshelfService {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;

    // Parse the URL to get the hostname
    let hostname;
    try {
      const url = new URL(this.baseUrl);
      hostname = url.hostname;
    } catch (e) {
      console.error('Invalid Audiobookshelf URL:', this.baseUrl);
      hostname = 'localhost';
    }

    // Create HTTPS agent with proper SNI support
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Host': hostname,
      },
      httpsAgent: new https.Agent({
        servername: hostname,
        rejectUnauthorized: false, // Allow self-signed certificates
      }),
    });

    // Socket.io connection state
    this.socket = null;
    this.socketReconnectAttempts = 0;
    this.socketMaxReconnectAttempts = 10;
    this.socketReconnectDelay = 1000; // Start with 1 second
    this.socketReconnectTimer = null;
    this.socketEventHandlers = [];
    this.socketConnected = false;

    // Track session progress to detect active playback
    // Map: sessionId -> { currentTime, lastChecked, lastProgressAt, lastEventAt }
    this.sessionProgressTracker = new Map();
    // Consider a session inactive if no progress or events for 5 minutes
    // (clients may sync progress infrequently, Socket.io events provide real-time updates)
    this.sessionInactivityThreshold = 5 * 60 * 1000;

    // Track active sessions by sessionId (updated via Socket.io events)
    this.activeSessionIds = new Set();

    // Database reference for cleanup operations
    this.db = null;
  }

  async testConnection() {
    try {
      // Get users data to check connection
      const usersResponse = await this.client.get('/api/users?openPlaySessions=1');

      let activeSessions = 0;
      let version = 'Unknown';

      if (usersResponse.data.users) {
        for (const user of usersResponse.data.users) {
          if (user.mostRecent?.mediaPlayer) {
            activeSessions++;
          }
        }
      }

      // Try multiple endpoints to get version
      try {
        // Try /ping endpoint which should return server info
        const pingResponse = await this.client.get('/ping', { timeout: 5000 });
        version = pingResponse.data.version || 'Unknown';
      } catch (pingError) {
        // Fallback to /api/authorize
        try {
          const authorizeResponse = await this.client.get('/api/authorize', { timeout: 5000 });
          version = authorizeResponse.data.serverSettings?.version ||
                    authorizeResponse.data.server?.version || 'Unknown';
        } catch (authorizeError) {
          console.log('Could not fetch Audiobookshelf version:', authorizeError.message);
        }
      }

      return {
        success: true,
        serverName: 'Audiobookshelf',
        version: version,
        message: `Connected successfully. Found ${activeSessions} active session(s).`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Connection failed: ${error.message}`,
      };
    }
  }

  async getSessions() {
    try {
      const response = await this.client.get('/api/users');
      // Audiobookshelf doesn't have a direct sessions endpoint
      // We'll need to check each user's current listening session
      const sessions = [];

      if (response.data.users) {
        for (const user of response.data.users) {
          if (user.mediaProgress && user.mediaProgress.length > 0) {
            // Check for active sessions
            const activeSessions = user.mediaProgress.filter(p => p.isFinished === false && p.currentTime);
            sessions.push(...activeSessions.map(s => ({ ...s, user })));
          }
        }
      }

      return sessions;
    } catch (error) {
      console.error('Error fetching Audiobookshelf sessions:', error.message);
      return [];
    }
  }

  async getLibraries() {
    try {
      const response = await this.client.get('/api/libraries');
      return response.data.libraries.map(lib => ({
        id: lib.id,
        name: lib.name,
        type: lib.mediaType,
        itemCount: lib.size,
      }));
    } catch (error) {
      console.error('Error fetching Audiobookshelf libraries:', error.message);
      return [];
    }
  }

  parseSessionToActivity(session) {
    // Audiobookshelf sessions are structured differently
    // This is a basic implementation - may need refinement based on actual API structure
    try {
      const item = session.libraryItem || {};
      const media = item.media || {};

      return {
        sessionKey: session.id || `abs-${Date.now()}`,
        userId: session.user?.id || 'unknown',
        username: session.user?.username || 'Unknown User',
        mediaType: 'audiobook',
        mediaId: item.id || 'unknown',
        title: media.metadata?.title || item.media?.metadata?.title || 'Unknown',
        parentTitle: media.metadata?.seriesName || null,
        grandparentTitle: null,
        seasonNumber: null,
        episodeNumber: null,
        year: media.metadata?.publishedYear || null,
        thumb: item.media?.coverPath ? `${this.baseUrl}${item.media.coverPath}` : null,
        art: null,
        state: session.currentTime > 0 ? 'playing' : 'paused',
        progressPercent: session.duration
          ? Math.round((session.currentTime / session.duration) * 100)
          : 0,
        duration: session.duration ? Math.round(session.duration) : null,
        currentTime: session.currentTime ? Math.round(session.currentTime) : 0,
        clientName: 'Audiobookshelf',
        deviceName: 'Web',
        platform: 'Audiobookshelf',
        bitrate: null, // Audiobookshelf doesn't provide bitrate info
        transcoding: false,
        videoCodec: null,
        audioCodec: media.audioFiles?.[0]?.codec || null,
        container: media.audioFiles?.[0]?.format || null,
        resolution: null,
      };
    } catch (error) {
      console.error('Error parsing Audiobookshelf session:', error.message);
      return null;
    }
  }

  async getActiveStreams() {
    // Use the proper endpoint for active playback sessions
    return await this.getActivePlaybackSessions();
  }

  async getPlaybackSessions() {
    try {
      // Instead of getting "open" sessions (which includes paused sessions),
      // we should look for users with active playback sessions
      // Try the /api/users endpoint with openPlaySessions parameter
      try {
        const usersResponse = await this.client.get('/api/users?openPlaySessions=1');
        const activeSessions = [];

        if (usersResponse.data.users) {
          for (const user of usersResponse.data.users) {
            // Check if user has an active session (mostRecent with mediaPlayer)
            if (user.mostRecent?.mediaPlayer) {
              // This user has an active playback session
              // Get their session details from /api/sessions
              const sessionResponse = await this.client.get(`/api/sessions?userId=${user.id}&filterBy=open&sort=updatedAt&desc=1&limit=1`);
              const userSessions = sessionResponse.data.sessions || sessionResponse.data || [];
              if (userSessions.length > 0) {
                activeSessions.push(...userSessions);
              }
            }
          }
        }

        if (activeSessions.length > 0) {
          console.log(`Found ${activeSessions.length} users with active playback`);
          return activeSessions;
        }
      } catch (userError) {
        console.log('Failed to check users for active sessions, falling back to open sessions');
      }

      // Fallback: Get open/active playback sessions from /api/sessions?filterBy=open
      // The default /api/sessions only returns closed/completed sessions
      // Sort by updatedAt descending to get the most recently active sessions first
      const response = await this.client.get('/api/sessions?filterBy=open&sort=updatedAt&desc=1');
      const sessions = response.data.sessions || response.data || [];
      return sessions;
    } catch (error) {
      console.error('Error fetching Audiobookshelf playback sessions:', error.message);
      return [];
    }
  }

  async getListeningSessions() {
    try {
      // Get all users
      const usersResponse = await this.client.get('/api/users');
      const allSessions = [];

      if (usersResponse.data.users) {
        for (const user of usersResponse.data.users) {
          try {
            // Get listening sessions for each user
            const sessionsResponse = await this.client.get(`/api/users/${user.id}/listening-sessions`);
            const sessions = sessionsResponse.data.sessions || [];

            // Add user info to each session
            for (const session of sessions) {
              session.username = user.username;
              session.userId = user.id;
            }

            allSessions.push(...sessions);
          } catch (error) {
            console.error(`Error fetching listening sessions for user ${user.username}:`, error.message);
          }
        }
      }

      console.log(`Found ${allSessions.length} total Audiobookshelf listening sessions across all users`);
      return allSessions;
    } catch (error) {
      console.error('Error fetching Audiobookshelf listening sessions:', error.message);
      return [];
    }
  }

  async getActivePlaybackSessions() {
    try {
      const sessions = await this.getPlaybackSessions();
      const activeStreams = [];
      const now = Date.now();

      console.log(`📊 Analyzing ${sessions.length} open Audiobookshelf sessions...`);

      // NEW APPROACH: Use updatedAt timestamp and playMethod as primary indicators
      // Group sessions by user to find the most recently active one per user
      const sessionsByUser = new Map();

      for (const session of sessions) {
        if (!session || !session.id || !session.libraryItemId || session.currentTime === undefined) {
          continue;
        }

        const userId = session.userId;
        const updatedAt = session.updatedAt ? new Date(session.updatedAt).getTime() : 0;
        const playMethod = session.playMethod;
        const mediaPlayer = session.mediaPlayer;

        // Calculate how recent this session is
        const ageMs = now - updatedAt;
        const ageMinutes = Math.floor(ageMs / 1000 / 60);
        const hasActivePlayer = playMethod !== null && playMethod !== undefined;

        console.log(`   ${session.displayTitle || 'Unknown'} (${session.user?.username || 'Unknown'})`);
        console.log(`      updatedAt: ${ageMinutes}m ago | playMethod: ${playMethod ?? 'null'} | mediaPlayer: ${mediaPlayer || 'null'}`);

        // Skip sessions that are too old AND don't have an active player
        // If playMethod is set, keep it regardless of age (it means a player is open)
        const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
        if (ageMs > MAX_AGE_MS && !hasActivePlayer) {
          console.log(`      ⏭️  Skipping: Too old (${ageMinutes}m) with no active player`);
          continue;
        }

        // For each user, keep track of their sessions
        if (!sessionsByUser.has(userId)) {
          sessionsByUser.set(userId, []);
        }
        sessionsByUser.get(userId).push({
          session,
          updatedAt,
          playMethod,
          mediaPlayer,
          ageMs,
          hasActivePlayer
        });
      }

      // For each user, pick the MOST RECENTLY UPDATED session with an active player
      const activeSessions = [];
      for (const [userId, userSessions] of sessionsByUser) {
        // Sort to prioritize:
        // 1. Sessions with playMethod set (active player) first
        // 2. Then by most recent updatedAt
        userSessions.sort((a, b) => {
          if (a.hasActivePlayer !== b.hasActivePlayer) {
            return b.hasActivePlayer - a.hasActivePlayer; // Active players first
          }
          return b.updatedAt - a.updatedAt; // Most recent first
        });

        const mostRecentSession = userSessions[0]; // Take the first after sorting

        // RELAXED: Accept sessions with recent updatedAt, even if playMethod is null/unknown
        // Some clients don't properly set playMethod but still update the session
        // updatedAt indicates the session is actively being updated (not stale)
        const STRICT_AGE_LIMIT = 2 * 60 * 1000; // 2 minutes - sessions older than this are considered inactive
        const isRecentlyActive = mostRecentSession.ageMs < STRICT_AGE_LIMIT;

        if (isRecentlyActive) {
          const ageMinutes = Math.floor(mostRecentSession.ageMs / 1000 / 60);
          const ageSeconds = Math.floor((mostRecentSession.ageMs % 60000) / 1000);
          const playMethodInfo = mostRecentSession.playMethod ?? 'unknown';
          console.log(`   ▶️  ACTIVE: ${mostRecentSession.session.displayTitle} - playMethod=${playMethodInfo} (${ageMinutes}m ${ageSeconds}s old)`);
          activeSessions.push(mostRecentSession.session);
        } else {
          const ageMinutes = Math.floor(mostRecentSession.ageMs / 1000 / 60);
          const ageSeconds = Math.floor((mostRecentSession.ageMs % 60000) / 1000);
          console.log(`   ⏸️  PAUSED: ${mostRecentSession.session.displayTitle} - too old (${ageMinutes}m ${ageSeconds}s)`);
        }
      }

      console.log(`Found ${activeSessions.length} active Audiobookshelf sessions (based on recent updatedAt)`);

      // Convert to activity format
      for (const session of activeSessions) {
        const activity = await this.parsePlaybackSession(session);
        if (activity) {
          activeStreams.push(activity);
        }
      }

      // Cleanup stale sessions in database if db is available
      if (this.db) {
        this.cleanupStaleSessions(activeStreams);
      }

      return activeStreams;
    } catch (error) {
      console.error('Error getting active playback sessions:', error.message);
      return [];
    }
  }

  async parsePlaybackSession(session) {
    try {
      // Use the direct session data structure from Audiobookshelf API
      const metadata = session.mediaMetadata || {};
      const seriesName = metadata.series?.[0]?.name || null;

      // Ensure required fields are present
      if (!session.id || !session.userId || !session.libraryItemId) {
        return null;
      }

      // Fetch library item details to get audio file info
      let audioCodec = null;
      let container = null;
      let bitrate = null;
      let channels = null;
      try {
        const itemResponse = await this.client.get(`/api/items/${session.libraryItemId}`);
        const audioFiles = itemResponse.data?.media?.audioFiles || [];
        if (audioFiles.length > 0) {
          const firstAudioFile = audioFiles[0];
          audioCodec = firstAudioFile.codec || null;
          container = firstAudioFile.format || null;
          bitrate = firstAudioFile.bitRate || null;
          channels = firstAudioFile.channels || null;
        }
      } catch (itemError) {
        // If we can't fetch item details, just continue without audio info
        console.log(`Could not fetch audio details for ${session.libraryItemId}`);
      }

      // Audiobookshelf API returns durations in seconds
      // But validate in case they're in milliseconds (> 10 days would be unusual)
      let duration = session.duration ? Math.round(session.duration) : null;
      let currentTime = session.currentTime ? Math.round(session.currentTime) : 0;

      // If values seem too large (> 864000 seconds = 10 days), assume milliseconds
      if (duration && duration > 864000) {
        console.log(`⚠️ Audiobookshelf: Large duration detected (${duration}), assuming milliseconds - converting to seconds`);
        duration = Math.round(duration / 1000);
        currentTime = Math.round(currentTime / 1000);
      }

      return {
        sessionKey: session.id,
        userId: session.userId,
        username: session.user?.username || 'Unknown User',
        mediaType: session.mediaType || 'audiobook',
        mediaId: session.libraryItemId,
        title: metadata.title || session.displayTitle || 'Unknown Title',
        parentTitle: seriesName,
        grandparentTitle: null,
        seasonNumber: null,
        episodeNumber: null,
        year: metadata.publishedYear || null,
        thumb: session.libraryItemId ? `${this.baseUrl}/api/items/${session.libraryItemId}/cover` : null,
        art: null,
        state: currentTime > 0 ? 'playing' : 'paused',
        progressPercent: duration
          ? Math.round((currentTime / duration) * 100)
          : 0,
        duration: duration,
        currentTime: currentTime,
        clientName: session.deviceInfo?.clientName || 'Audiobookshelf',
        deviceName: session.deviceInfo?.deviceName || 'Unknown Device',
        platform: 'Audiobookshelf',
        bitrate: bitrate,
        transcoding: false,
        videoCodec: null,
        audioCodec: audioCodec,
        container: container,
        resolution: null,
        audioChannels: channels,
        // Location info
        ipAddress: session.deviceInfo?.ipAddress || null,
        location: null, // Audiobookshelf doesn't provide local/remote distinction
      };
    } catch (error) {
      console.error('Error parsing Audiobookshelf playback session:', error.message);
      return null;
    }
  }

  /**
   * Socket.io connection for real-time notifications
   */
  connectSocket() {
    if (this.socket && this.socket.connected) {
      console.log('🔌 Audiobookshelf Socket.io already connected');
      return;
    }

    try {
      console.log('🔌 Connecting to Audiobookshelf Socket.io...');

      // Socket.io connection with authentication
      this.socket = io(this.baseUrl, {
        auth: {
          token: this.apiKey
        },
        transports: ['websocket', 'polling'],
        rejectUnauthorized: false, // Allow self-signed certificates
        reconnection: false, // We'll handle reconnection manually
      });

      this.socket.on('connect', () => {
        console.log('✅ Audiobookshelf Socket.io connected');
        this.socketConnected = true;
        this.socketReconnectAttempts = 0;
        this.socketReconnectDelay = 1000; // Reset delay
      });

      this.socket.on('disconnect', (reason) => {
        console.log(`🔌 Audiobookshelf Socket.io disconnected (reason: ${reason})`);
        this.socketConnected = false;

        // Only reconnect if not a manual disconnect
        if (reason !== 'io client disconnect') {
          this.scheduleReconnect();
        }
      });

      this.socket.on('connect_error', (error) => {
        console.error('❌ Audiobookshelf Socket.io connection error:', error.message);
        this.scheduleReconnect();
      });

      // Listen for all stream-related events
      // Based on Audiobookshelf API documentation
      const streamEvents = [
        'user_stream_update',      // User stream state changed
        'user_item_progress_updated', // Progress updated for an item
        'stream_open',             // Stream opened
        'stream_closed',           // Stream closed
        'stream_progress',         // Stream progress update
        'stream_ready',            // Stream is ready
        'playback_session_started',
        'playback_session_ended',
      ];

      streamEvents.forEach(eventName => {
        this.socket.on(eventName, (data) => {
          console.log(`📨 Audiobookshelf Socket.io event: ${eventName}`);
          this.handleSocketEvent(eventName, data);
        });
      });

      // Generic catch-all for ANY AND ALL events (with full debugging)
      this.socket.onAny((eventName, ...args) => {
        // Log ALL events except connection lifecycle ones
        if (!['connect', 'disconnect', 'connect_error', 'reconnect', 'ping', 'pong'].includes(eventName)) {
          console.log(`📨 Audiobookshelf Socket.io event received: ${eventName}`);
          console.log(`   Event data:`, JSON.stringify(args, null, 2));
        }
      });

    } catch (error) {
      console.error('Error creating Audiobookshelf Socket.io connection:', error.message);
      this.scheduleReconnect();
    }
  }

  handleSocketEvent(eventName, data) {
    try {
      // Map event names to our internal event types
      let eventType = 'session_update';

      if (eventName === 'stream_open' || eventName === 'playback_session_started') {
        eventType = 'session_started';
      } else if (eventName === 'stream_closed' || eventName === 'playback_session_ended') {
        eventType = 'session_stopped';
      } else if (eventName === 'stream_progress' || eventName === 'user_item_progress_updated') {
        eventType = 'session_progress';
      }

      // Update active session tracking based on Socket.io events
      this.updateSessionActivityFromEvent(eventType, data);

      // Notify all registered event handlers
      for (const handler of this.socketEventHandlers) {
        try {
          handler({
            type: eventType,
            originalEvent: eventName,
            data: data
          });
        } catch (error) {
          console.error('Error in Socket.io event handler:', error.message);
        }
      }
    } catch (error) {
      console.error('Error handling Audiobookshelf Socket.io event:', error.message);
    }
  }

  updateSessionActivityFromEvent(eventType, data) {
    try {
      const now = Date.now();

      // Extract session ID from event data
      let sessionId = data?.id || data?.sessionId || data?.playSessionId;

      // For user_item_progress_updated, we may need to get the session ID differently
      if (!sessionId && data?.session) {
        sessionId = data.session.id || data.session.sessionId;
      }

      if (!sessionId) {
        // Can't track without a session ID
        return;
      }

      if (eventType === 'session_started' || eventType === 'session_progress') {
        // Mark this session as active
        this.activeSessionIds.add(sessionId);

        // Update last event time in tracker
        const tracked = this.sessionProgressTracker.get(sessionId);
        if (tracked) {
          tracked.lastEventAt = now;
        } else {
          // Create new tracking entry
          this.sessionProgressTracker.set(sessionId, {
            currentTime: data?.currentTime || 0,
            lastChecked: now,
            lastProgressAt: null,
            lastEventAt: now
          });
        }

        console.log(`🔔 Socket.io event marks session ${sessionId} as active (${eventType})`);
      } else if (eventType === 'session_stopped') {
        // Remove from active sessions
        this.activeSessionIds.delete(sessionId);
        console.log(`🔕 Socket.io event marks session ${sessionId} as stopped`);
      }
    } catch (error) {
      console.error('Error updating session activity from event:', error.message);
    }
  }

  scheduleReconnect() {
    if (this.socketReconnectTimer) {
      clearTimeout(this.socketReconnectTimer);
    }

    if (this.socketReconnectAttempts >= this.socketMaxReconnectAttempts) {
      console.log(`⚠️  Max Audiobookshelf Socket.io reconnection attempts (${this.socketMaxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    this.socketReconnectAttempts++;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 64s max
    const delay = Math.min(this.socketReconnectDelay * Math.pow(2, this.socketReconnectAttempts - 1), 64000);

    console.log(`🔄 Reconnecting to Audiobookshelf Socket.io in ${delay / 1000}s (attempt ${this.socketReconnectAttempts}/${this.socketMaxReconnectAttempts})...`);

    this.socketReconnectTimer = setTimeout(() => {
      this.connectSocket();
    }, delay);
  }

  disconnectSocket() {
    if (this.socketReconnectTimer) {
      clearTimeout(this.socketReconnectTimer);
      this.socketReconnectTimer = null;
    }

    if (this.socket) {
      console.log('🔌 Disconnecting Audiobookshelf Socket.io...');
      this.socket.disconnect();
      this.socket = null;
      this.socketConnected = false;
    }
  }

  onSocketEvent(handler) {
    this.socketEventHandlers.push(handler);
  }

  removeSocketEventHandler(handler) {
    const index = this.socketEventHandlers.indexOf(handler);
    if (index > -1) {
      this.socketEventHandlers.splice(index, 1);
    }
  }

  isSocketConnected() {
    return this.socketConnected && this.socket && this.socket.connected;
  }

  // Set database reference for cleanup operations
  setDatabase(db) {
    this.db = db;
  }

  // Clean up stale sessions in the database
  cleanupStaleSessions(activeStreams) {
    if (!this.db) {
      console.log('   ⚠️  Database not available for cleanup');
      return;
    }

    try {
      // Build a Set of active session keys for quick lookup
      const activeSessionKeys = new Set(activeStreams.map(s => s.sessionKey));

      // Get all Audiobookshelf sessions currently marked as playing/paused/buffering
      const dbSessions = this.db.prepare(`
        SELECT session_key, title, username
        FROM sessions
        WHERE server_type = 'audiobookshelf'
          AND state IN ('playing', 'paused', 'buffering')
      `).all();

      console.log(`   🔍 Cleanup check: ${dbSessions.length} DB sessions, ${activeStreams.length} active API sessions`);

      const now = Math.floor(Date.now() / 1000);
      let cleanedCount = 0;

      for (const dbSession of dbSessions) {
        // If this session is not in the active list, mark it as stopped
        if (!activeSessionKeys.has(dbSession.session_key)) {
          this.db.prepare(`
            UPDATE sessions
            SET state = 'stopped',
                stopped_at = ?
            WHERE session_key = ? AND server_type = 'audiobookshelf'
          `).run(now, dbSession.session_key);

          cleanedCount++;
          console.log(`   🧹 Cleaned up stale session: ${dbSession.title} (${dbSession.username})`);
        }
      }

      if (cleanedCount > 0) {
        console.log(`✅ Cleaned up ${cleanedCount} stale Audiobookshelf session(s)`);
      }
    } catch (error) {
      console.error('Error cleaning up stale Audiobookshelf sessions:', error.message);
    }
  }
}

export default AudiobookshelfService;
