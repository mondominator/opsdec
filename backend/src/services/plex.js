import axios from 'axios';
import WebSocket from 'ws';

class PlexService {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-Plex-Token': this.token,
        'Accept': 'application/json',
      },
    });

    // WebSocket connection state
    this.ws = null;
    this.wsReconnectAttempts = 0;
    this.wsMaxReconnectAttempts = 10;
    this.wsReconnectDelay = 1000; // Start with 1 second
    this.wsReconnectTimer = null;
    this.wsEventHandlers = [];
    this.wsConnected = false;
  }

  async testConnection() {
    try {
      const response = await this.client.get('/');
      return {
        success: true,
        serverName: response.data.MediaContainer.friendlyName,
        version: response.data.MediaContainer.version,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getSessions() {
    const response = await this.client.get('/status/sessions');
    return response.data.MediaContainer.Metadata || [];
  }

  async getUsers() {
    try {
      const response = await this.client.get('/accounts');
      const users = response.data.MediaContainer.Account || [];
      return users.map(user => ({
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        thumb: user.thumb,
      }));
    } catch (error) {
      console.error('Error fetching Plex users:', error.message);
      // Fallback: get users from library sections
      try {
        const homeUsers = await this.client.get('/api/home/users');
        return (homeUsers.data.MediaContainer.User || []).map(user => ({
          id: user.id.toString(),
          name: user.title || user.username,
          email: user.email,
          thumb: user.thumb,
        }));
      } catch (fallbackError) {
        console.error('Error fetching Plex home users:', fallbackError.message);
        return [];
      }
    }
  }

  async getLibraries() {
    try {
      const response = await this.client.get('/library/sections');
      const sections = response.data.MediaContainer.Directory || [];
      return sections.map(lib => ({
        id: lib.key,
        name: lib.title,
        type: lib.type,
        itemCount: lib.count || 0,
      }));
    } catch (error) {
      console.error('Error fetching Plex libraries:', error.message);
      return [];
    }
  }

  parseSessionToActivity(session) {
    try {
      const user = session.User;
      const player = session.Player || {};
      const playState = player.state || 'unknown';

      // Determine media type
      let mediaType = session.type.toLowerCase();
      if (mediaType === 'movie') {
        mediaType = 'movie';
      } else if (mediaType === 'episode') {
        mediaType = 'episode';
      } else if (mediaType === 'track') {
        mediaType = 'track';
      }

      // Get transcode/media info
      const transcodeSession = session.TranscodeSession || {};
      const media = session.Media?.[0] || {};
      const videoStream = media.Part?.[0]?.Stream?.find(s => s.streamType === 1); // 1 = video
      const audioStream = media.Part?.[0]?.Stream?.find(s => s.streamType === 2); // 2 = audio

      // Calculate bitrate
      const bitrate = media.bitrate ? (media.bitrate / 1000).toFixed(2) : null; // Convert to Mbps

      // Generate a stable session key - prefer Session.id, then sessionKey
      // Fallback to a deterministic key based on user, device, and media to avoid duplicates
      let sessionKey = session.Session?.id || session.sessionKey;
      if (!sessionKey) {
        // Generate deterministic key from user + device + media to prevent duplicates
        const userId = user?.id || 'unknown';
        const deviceId = player.machineIdentifier || player.device || 'unknown';
        const mediaId = session.ratingKey || 'unknown';
        sessionKey = `plex-${userId}-${deviceId}-${mediaId}`;
        console.log(`⚠️ Plex: Generated fallback session key: ${sessionKey}`);
      }

      // Build activity object
      return {
        sessionKey: sessionKey,
        userId: user?.id?.toString() || 'unknown',
        username: user?.title || 'Unknown User',
        userThumb: user?.thumb || null,
        mediaType,
        mediaId: session.ratingKey,
        title: session.title,
        parentTitle: session.grandparentTitle || session.parentTitle || null,
        grandparentTitle: session.grandparentTitle || null,
        seasonNumber: session.parentIndex || null,
        episodeNumber: session.index || null,
        year: session.year,
        // For episodes, use grandparent (series) thumb; for movies use the movie thumb
        thumb: mediaType === 'episode' && session.grandparentThumb
          ? `${this.baseUrl}${session.grandparentThumb}?X-Plex-Token=${this.token}`
          : session.thumb
          ? `${this.baseUrl}${session.thumb}?X-Plex-Token=${this.token}`
          : null,
        art: session.art ? `${this.baseUrl}${session.art}?X-Plex-Token=${this.token}` : null,
        state: playState === 'paused' ? 'paused' : playState === 'buffering' ? 'buffering' : 'playing',
        progressPercent: session.viewOffset && session.duration
          ? Math.round((session.viewOffset / session.duration) * 100)
          : 0,
        duration: session.duration ? Math.round(session.duration / 1000) : null, // Convert to seconds
        currentTime: session.viewOffset ? Math.round(session.viewOffset / 1000) : 0,
        clientName: player.title || 'Unknown Client',
        deviceName: player.device || 'Unknown Device',
        platform: player.platform || 'Unknown Platform',
        // Bandwidth/Stream info
        bitrate: bitrate,
        transcoding: transcodeSession.videoDecision === 'transcode' || transcodeSession.audioDecision === 'transcode',
        videoCodec: videoStream?.codec || transcodeSession.videoCodec || null,
        audioCodec: audioStream?.codec || transcodeSession.audioCodec || null,
        container: media.container || null,
        resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : null,
        // Location info
        ipAddress: player.address || null,
        location: session.Session?.location || null, // 'lan' or 'wan'
      };
    } catch (error) {
      console.error('Error parsing Plex session:', error);
      return null;
    }
  }

  async getActiveStreams() {
    const sessions = await this.getSessions();
    const activeStreams = [];

    for (const session of sessions) {
      const activity = this.parseSessionToActivity(session);
      if (activity) {
        activeStreams.push(activity);
      }
    }

    return activeStreams;
  }

  async getRecentlyAdded(limit = 20) {
    try {
      const response = await this.client.get('/library/recentlyAdded', {
        params: {
          'X-Plex-Container-Start': 0,
          'X-Plex-Container-Size': limit,
        },
      });

      const items = response.data.MediaContainer.Metadata || [];
      return items.map(item => ({
        id: item.ratingKey,
        name: item.type === 'season' ? (item.parentTitle || item.title) : item.title,
        type: item.type,
        year: item.year,
        seriesName: item.type === 'season' ? item.title : item.grandparentTitle,
        addedAt: item.addedAt ? new Date(item.addedAt * 1000).toISOString() : null,
        thumb: item.thumb ? `${this.baseUrl}${item.thumb}?X-Plex-Token=${this.token}` : null,
      }));
    } catch (error) {
      console.error('Error fetching recently added:', error.message);
      return [];
    }
  }

  async getHistory(limit = 50) {
    try {
      const response = await this.client.get('/status/sessions/history/all', {
        params: {
          sort: 'viewedAt:desc',
          'X-Plex-Container-Start': 0,
          'X-Plex-Container-Size': limit,
        },
      });

      const items = response.data.MediaContainer.Metadata || [];
      return items.map(item => ({
        id: item.historyKey,
        mediaId: item.ratingKey,
        title: item.title,
        parentTitle: item.grandparentTitle || item.parentTitle,
        type: item.type,
        viewedAt: item.viewedAt,
        accountId: item.accountID,
      }));
    } catch (error) {
      console.error('Error fetching Plex history:', error.message);
      return [];
    }
  }

  async getItemInfo(ratingKey) {
    try {
      const response = await this.client.get(`/library/metadata/${ratingKey}`);
      const item = response.data.MediaContainer.Metadata?.[0];
      if (!item) {
        return { exists: false, coverUrl: null };
      }

      // For episodes, use series thumb; for movies/other use item thumb
      const thumbPath = item.type === 'episode' && item.grandparentThumb
        ? item.grandparentThumb
        : item.thumb;

      return {
        exists: true,
        title: item.title || null,
        grandparentTitle: item.grandparentTitle || null,
        coverUrl: thumbPath ? `${this.baseUrl}${thumbPath}?X-Plex-Token=${this.token}` : null
      };
    } catch (error) {
      // 404 means item doesn't exist
      if (error.response?.status === 404) {
        return { exists: false, coverUrl: null };
      }
      console.error(`Error fetching Plex item ${ratingKey}:`, error.message);
      return { exists: false, coverUrl: null };
    }
  }

  async searchByTitle(title, mediaType = null) {
    try {
      const response = await this.client.get('/search', {
        params: { query: title }
      });

      const results = response.data.MediaContainer.Metadata || [];

      // Find exact or close title match
      for (const item of results) {
        // Skip if mediaType specified and doesn't match
        if (mediaType && item.type !== mediaType) continue;

        const itemTitle = item.title || '';
        if (itemTitle.toLowerCase() === title.toLowerCase()) {
          // For episodes, use series thumb; for movies/other use item thumb
          const thumbPath = item.type === 'episode' && item.grandparentThumb
            ? item.grandparentThumb
            : item.thumb;

          return {
            id: item.ratingKey,
            title: itemTitle,
            coverUrl: thumbPath ? `${this.baseUrl}${thumbPath}?X-Plex-Token=${this.token}` : null
          };
        }
      }
      return null;
    } catch (error) {
      console.error('Error searching Plex by title:', error.message);
      return null;
    }
  }

  /**
   * WebSocket connection for real-time notifications
   */
  connectWebSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('🔌 Plex WebSocket already connected');
      return;
    }

    try {
      // Convert HTTP/HTTPS URL to WS/WSS
      const wsUrl = this.baseUrl
        .replace('http://', 'ws://')
        .replace('https://', 'wss://');

      const wsEndpoint = `${wsUrl}/:/websockets/notifications?X-Plex-Token=${this.token}`;

      console.log('🔌 Connecting to Plex WebSocket...');
      this.ws = new WebSocket(wsEndpoint, {
        rejectUnauthorized: false, // Allow self-signed certificates
      });

      this.ws.on('open', () => {
        console.log('✅ Plex WebSocket connected');
        this.wsConnected = true;
        this.wsReconnectAttempts = 0;
        this.wsReconnectDelay = 1000; // Reset delay
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('Error parsing Plex WebSocket message:', error.message);
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ Plex WebSocket error:', error.message);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`🔌 Plex WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
        this.wsConnected = false;
        this.ws = null;
        this.scheduleReconnect();
      });

    } catch (error) {
      console.error('Error creating Plex WebSocket:', error.message);
      this.scheduleReconnect();
    }
  }

  handleWebSocketMessage(message) {
    try {
      const container = message.NotificationContainer;
      if (!container) return;

      const type = container.type;

      // Filter for interesting message types (playing, timeline, activity)
      const interestingTypes = ['playing', 'timeline', 'activity'];
      if (!interestingTypes.includes(type)) {
        return;
      }

      console.log(`📨 Plex WebSocket event: ${type}`);

      // Handle 'playing' notifications - these contain PlaySessionStateNotification
      if (type === 'playing' && container.PlaySessionStateNotification) {
        const notifications = Array.isArray(container.PlaySessionStateNotification)
          ? container.PlaySessionStateNotification
          : [container.PlaySessionStateNotification];

        for (const notification of notifications) {
          this.handlePlayingNotification(notification);
        }
      }

      // Notify all registered event handlers
      for (const handler of this.wsEventHandlers) {
        try {
          handler({ type, data: container });
        } catch (error) {
          console.error('Error in WebSocket event handler:', error.message);
        }
      }
    } catch (error) {
      console.error('Error handling Plex WebSocket message:', error.message);
    }
  }

  async handlePlayingNotification(notification) {
    try {
      const sessionKey = notification.sessionKey;
      const state = notification.state; // 'playing', 'paused', 'stopped', 'buffering'
      const ratingKey = notification.ratingKey;

      console.log(`   Session ${sessionKey}: ${state} (ratingKey: ${ratingKey})`);

      // When we receive a playing notification, fetch the full session data
      // This ensures we have all the metadata and stream info
      if (state === 'playing' || state === 'paused' || state === 'buffering') {
        // Trigger a session fetch to get updated data
        // The monitor service will handle this through its normal polling
        // But we can notify handlers that something changed
        for (const handler of this.wsEventHandlers) {
          try {
            handler({
              type: 'session_update',
              sessionKey,
              state,
              ratingKey,
            });
          } catch (error) {
            console.error('Error in session update handler:', error.message);
          }
        }
      } else if (state === 'stopped') {
        // Session stopped - notify handlers
        for (const handler of this.wsEventHandlers) {
          try {
            handler({
              type: 'session_stopped',
              sessionKey,
              ratingKey,
            });
          } catch (error) {
            console.error('Error in session stopped handler:', error.message);
          }
        }
      }
    } catch (error) {
      console.error('Error handling playing notification:', error.message);
    }
  }

  scheduleReconnect() {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
    }

    if (this.wsReconnectAttempts >= this.wsMaxReconnectAttempts) {
      console.log(`⚠️  Max Plex WebSocket reconnection attempts (${this.wsMaxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    this.wsReconnectAttempts++;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 64s max
    const delay = Math.min(this.wsReconnectDelay * Math.pow(2, this.wsReconnectAttempts - 1), 64000);

    console.log(`🔄 Reconnecting to Plex WebSocket in ${delay / 1000}s (attempt ${this.wsReconnectAttempts}/${this.wsMaxReconnectAttempts})...`);

    this.wsReconnectTimer = setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  disconnectWebSocket() {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }

    if (this.ws) {
      console.log('🔌 Disconnecting Plex WebSocket...');
      this.ws.close();
      this.ws = null;
      this.wsConnected = false;
    }
  }

  onWebSocketEvent(handler) {
    this.wsEventHandlers.push(handler);
  }

  removeWebSocketEventHandler(handler) {
    const index = this.wsEventHandlers.indexOf(handler);
    if (index > -1) {
      this.wsEventHandlers.splice(index, 1);
    }
  }

  isWebSocketConnected() {
    return this.wsConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

export default PlexService;
