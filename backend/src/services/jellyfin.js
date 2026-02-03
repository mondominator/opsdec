import axios from 'axios';
import WebSocket from 'ws';
import crypto from 'crypto';

class JellyfinService {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-Emby-Token': this.apiKey, // Jellyfin still accepts X-Emby-Token for compatibility
        'Authorization': `MediaBrowser Token="${this.apiKey}"`,
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
    this.deviceId = crypto.randomUUID(); // Generate unique device ID
  }

  async testConnection() {
    try {
      const response = await this.client.get('/System/Info');
      return {
        success: true,
        serverName: response.data.ServerName,
        version: response.data.Version,
        message: `Connected to Jellyfin ${response.data.Version}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getSessions() {
    try {
      const response = await this.client.get('/Sessions');
      return response.data;
    } catch (error) {
      console.error('Error fetching Jellyfin sessions:', error.message);
      return [];
    }
  }

  async getUsers() {
    try {
      const response = await this.client.get('/Users');
      return response.data.map(user => ({
        id: user.Id,
        name: user.Name,
        lastActivityDate: user.LastActivityDate,
        lastLoginDate: user.LastLoginDate,
        hasPassword: user.HasPassword,
        hasConfiguredPassword: user.HasConfiguredPassword,
        hasConfiguredEasyPassword: user.HasConfiguredEasyPassword,
        enableAutoLogin: user.EnableAutoLogin,
        policy: user.Policy,
      }));
    } catch (error) {
      console.error('Error fetching Jellyfin users:', error.message);
      return [];
    }
  }

  async getLibraries() {
    try {
      const response = await this.client.get('/Library/MediaFolders');
      return response.data.Items.map(lib => ({
        id: lib.Id,
        name: lib.Name,
        type: lib.CollectionType,
        itemCount: lib.ChildCount,
      }));
    } catch (error) {
      console.error('Error fetching Jellyfin libraries:', error.message);
      return [];
    }
  }

  async getItem(itemId) {
    try {
      const response = await this.client.get(`/Users/${await this.getFirstUserId()}/Items/${itemId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching item ${itemId}:`, error.message);
      return null;
    }
  }

  async getItemInfo(itemId) {
    try {
      const item = await this.getItem(itemId);
      if (!item) {
        return { exists: false, coverUrl: null };
      }

      // For episodes, use series image; for movies/other use item image
      const coverUrl = item.Type?.toLowerCase() === 'episode' && (item.SeriesId || item.SeriesPrimaryImageTag)
        ? `${this.baseUrl}/Items/${item.SeriesId || item.ParentId}/Images/Primary?api_key=${this.apiKey}`
        : item.ImageTags?.Primary
        ? `${this.baseUrl}/Items/${item.Id}/Images/Primary?api_key=${this.apiKey}`
        : null;

      return { exists: true, coverUrl };
    } catch (error) {
      if (error.response?.status === 404) {
        return { exists: false, coverUrl: null };
      }
      console.error(`Error fetching Jellyfin item info ${itemId}:`, error.message);
      return { exists: false, coverUrl: null };
    }
  }

  async searchByTitle(title, mediaType = null) {
    try {
      const response = await this.client.get('/Search/Hints', {
        params: {
          SearchTerm: title,
          Limit: 10
        }
      });

      const results = response.data.SearchHints || [];

      // Find exact or close title match
      for (const item of results) {
        // Skip if mediaType specified and doesn't match
        if (mediaType && item.Type?.toLowerCase() !== mediaType) continue;

        const itemTitle = item.Name || '';
        if (itemTitle.toLowerCase() === title.toLowerCase()) {
          // For episodes, use series image; for movies/other use item image
          const coverUrl = item.Type?.toLowerCase() === 'episode' && item.SeriesId
            ? `${this.baseUrl}/Items/${item.SeriesId}/Images/Primary?api_key=${this.apiKey}`
            : `${this.baseUrl}/Items/${item.ItemId || item.Id}/Images/Primary?api_key=${this.apiKey}`;

          return {
            id: item.ItemId || item.Id,
            title: itemTitle,
            coverUrl
          };
        }
      }
      return null;
    } catch (error) {
      console.error('Error searching Jellyfin by title:', error.message);
      return null;
    }
  }

  async getFirstUserId() {
    const users = await this.getUsers();
    return users.length > 0 ? users[0].id : null;
  }

  parseSessionToActivity(session) {
    if (!session.NowPlayingItem) {
      return null;
    }

    const item = session.NowPlayingItem;
    const playState = session.PlayState || {};
    const transcodeInfo = session.TranscodingInfo || {};

    // Calculate bitrate (in Mbps)
    const transcodeBitrate = transcodeInfo.Bitrate ? (transcodeInfo.Bitrate / 1000000).toFixed(2) : null;

    // Get stream info
    const videoStream = item.MediaStreams?.find(s => s.Type === 'Video');
    const audioStream = item.MediaStreams?.find(s => s.Type === 'Audio');

    // Get bitrate from media source if transcoding info doesn't have it
    const mediaBitrate = item.MediaSources?.[0]?.Bitrate ? (item.MediaSources[0].Bitrate / 1000000).toFixed(2) : null;

    // Try video stream bitrate if others aren't available
    const streamBitrate = videoStream?.BitRate ? (videoStream.BitRate / 1000000).toFixed(2) : null;

    const finalBitrate = transcodeBitrate || mediaBitrate || streamBitrate;

    return {
      sessionKey: session.Id,
      userId: session.UserId,
      username: session.UserName,
      userThumb: session.UserPrimaryImageTag ? `${this.baseUrl}/Users/${session.UserId}/Images/Primary?api_key=${this.apiKey}` : null,
      mediaType: item.Type.toLowerCase(),
      mediaId: item.Id,
      title: item.Name,
      parentTitle: item.SeriesName || null,
      grandparentTitle: item.SeriesName || null,
      seasonNumber: item.ParentIndexNumber || null,
      episodeNumber: item.IndexNumber || null,
      year: item.ProductionYear,
      // For episodes, use the series poster; for movies use the movie poster
      thumb: item.Type.toLowerCase() === 'episode' && (item.SeriesId || item.SeriesPrimaryImageTag)
        ? `${this.baseUrl}/Items/${item.SeriesId || item.ParentId}/Images/Primary?api_key=${this.apiKey}`
        : item.ImageTags?.Primary
        ? `${this.baseUrl}/Items/${item.Id}/Images/Primary?api_key=${this.apiKey}`
        : null,
      art: item.ParentBackdropImageTags?.[0] ? `${this.baseUrl}/Items/${item.ParentBackdropItemId}/Images/Backdrop?api_key=${this.apiKey}` : null,
      state: playState.IsPaused ? 'paused' : 'playing',
      progressPercent: playState.PositionTicks && item.RunTimeTicks
        ? Math.round((playState.PositionTicks / item.RunTimeTicks) * 100)
        : 0,
      duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : null, // Convert to seconds
      currentTime: playState.PositionTicks ? Math.round(playState.PositionTicks / 10000000) : 0,
      clientName: session.Client,
      deviceName: session.DeviceName,
      platform: session.Client,
      // Bandwidth/Stream info
      bitrate: finalBitrate,
      transcoding: transcodeInfo.IsVideoDirect === false || transcodeInfo.IsAudioDirect === false,
      videoCodec: videoStream?.Codec || transcodeInfo.VideoCodec || null,
      audioCodec: audioStream?.Codec || transcodeInfo.AudioCodec || null,
      container: item.Container || null,
      resolution: videoStream ? `${videoStream.Width}x${videoStream.Height}` : null,
      // Location info
      ipAddress: session.RemoteEndPoint || null,
      location: session.IsLocal === false ? 'wan' : 'lan',
    };
  }

  async getActiveStreams() {
    const sessions = await this.getSessions();
    const activeStreams = [];

    for (const session of sessions) {
      if (session.NowPlayingItem) {
        const activity = this.parseSessionToActivity(session);
        if (activity) {
          activeStreams.push(activity);
        }
      }
    }

    return activeStreams;
  }

  async getRecentlyAdded(limit = 20) {
    try {
      const userId = await this.getFirstUserId();
      if (!userId) return [];

      const response = await this.client.get('/Users/' + userId + '/Items/Latest', {
        params: {
          Limit: limit,
          Fields: 'BasicSyncInfo,Path,ProductionYear',
          IncludeItemTypes: 'Movie,Episode',
        },
      });

      return response.data.map(item => ({
        id: item.Id,
        name: item.Name,
        type: item.Type,
        year: item.ProductionYear,
        seriesName: item.SeriesName,
        addedAt: item.DateCreated,
        thumb: item.ImageTags?.Primary ? `${this.baseUrl}/Items/${item.Id}/Images/Primary?api_key=${this.apiKey}` : null,
      }));
    } catch (error) {
      console.error('Error fetching recently added:', error.message);
      return [];
    }
  }

  /**
   * WebSocket connection for real-time notifications
   */
  connectWebSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('🔌 Jellyfin WebSocket already connected');
      return;
    }

    try {
      // Convert HTTP/HTTPS URL to WS/WSS
      const wsUrl = this.baseUrl
        .replace('http://', 'ws://')
        .replace('https://', 'wss://');

      const wsEndpoint = `${wsUrl}/socket?api_key=${this.apiKey}&deviceId=${this.deviceId}`;

      console.log('🔌 Connecting to Jellyfin WebSocket...');
      this.ws = new WebSocket(wsEndpoint, {
        rejectUnauthorized: false, // Allow self-signed certificates
      });

      this.ws.on('open', () => {
        console.log('✅ Jellyfin WebSocket connected');
        this.wsConnected = true;
        this.wsReconnectAttempts = 0;
        this.wsReconnectDelay = 1000; // Reset delay

        // Subscribe to session updates (every 1500ms)
        this.ws.send(JSON.stringify({
          MessageType: 'SessionsStart',
          Data: '0,1500'
        }));
        console.log('📡 Subscribed to Jellyfin session updates');
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('Error parsing Jellyfin WebSocket message:', error.message);
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ Jellyfin WebSocket error:', error.message);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`🔌 Jellyfin WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
        this.wsConnected = false;
        this.ws = null;
        this.scheduleReconnect();
      });

    } catch (error) {
      console.error('Error creating Jellyfin WebSocket:', error.message);
      this.scheduleReconnect();
    }
  }

  handleWebSocketMessage(message) {
    try {
      const messageType = message.MessageType;
      const data = message.Data;

      if (!messageType) return;

      // Filter for interesting message types
      const interestingTypes = ['Sessions', 'PlaybackStarted', 'PlaybackStopped', 'SessionEnded', 'PlaybackProgress'];
      if (!interestingTypes.includes(messageType)) {
        return;
      }

      console.log(`📨 Jellyfin WebSocket event: ${messageType}`);

      // Handle different message types
      if (messageType === 'Sessions') {
        // Sessions update - contains full session data
        this.handleSessionsUpdate(data);
      } else if (messageType === 'PlaybackStarted' || messageType === 'PlaybackStopped' || messageType === 'SessionEnded' || messageType === 'PlaybackProgress') {
        // Playback state changed
        this.handlePlaybackEvent(messageType, data);
      }

      // Notify all registered event handlers
      for (const handler of this.wsEventHandlers) {
        try {
          handler({ type: messageType, data: data });
        } catch (error) {
          console.error('Error in WebSocket event handler:', error.message);
        }
      }
    } catch (error) {
      console.error('Error handling Jellyfin WebSocket message:', error.message);
    }
  }

  handleSessionsUpdate(sessions) {
    // Sessions update received - notify handlers to check for updates
    for (const handler of this.wsEventHandlers) {
      try {
        handler({
          type: 'session_update',
          sessions: sessions
        });
      } catch (error) {
        console.error('Error in sessions update handler:', error.message);
      }
    }
  }

  handlePlaybackEvent(eventType, data) {
    // Playback event (Started, Stopped, SessionEnded, Progress)
    const eventMap = {
      'PlaybackStarted': 'session_started',
      'PlaybackStopped': 'session_stopped',
      'SessionEnded': 'session_ended',
      'PlaybackProgress': 'session_progress'
    };

    for (const handler of this.wsEventHandlers) {
      try {
        handler({
          type: eventMap[eventType] || 'session_update',
          eventType: eventType,
          data: data
        });
      } catch (error) {
        console.error('Error in playback event handler:', error.message);
      }
    }
  }

  scheduleReconnect() {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
    }

    if (this.wsReconnectAttempts >= this.wsMaxReconnectAttempts) {
      console.log(`⚠️  Max Jellyfin WebSocket reconnection attempts (${this.wsMaxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    this.wsReconnectAttempts++;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 64s max
    const delay = Math.min(this.wsReconnectDelay * Math.pow(2, this.wsReconnectAttempts - 1), 64000);

    console.log(`🔄 Reconnecting to Jellyfin WebSocket in ${delay / 1000}s (attempt ${this.wsReconnectAttempts}/${this.wsMaxReconnectAttempts})...`);

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
      console.log('🔌 Disconnecting Jellyfin WebSocket...');
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

export default JellyfinService;
