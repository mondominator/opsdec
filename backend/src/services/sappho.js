import axios from 'axios';
import https from 'https';
import WebSocket from 'ws';

class SapphoService {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;

    // Parse the URL to get the hostname
    let hostname;
    try {
      const url = new URL(this.baseUrl);
      hostname = url.hostname;
    } catch {
      console.error('Invalid Sappho URL:', this.baseUrl);
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

    // WebSocket connection state
    this.ws = null;
    this.wsReconnectAttempts = 0;
    this.wsMaxReconnectAttempts = 10;
    this.wsReconnectDelay = 1000;
    this.wsReconnectTimer = null;
    this.wsEventHandlers = [];
    this.wsConnected = false;
  }

  async testConnection() {
    try {
      // Test connection using the health endpoint
      const response = await this.client.get('/api/health');

      return {
        success: true,
        serverName: 'Sappho',
        version: response.data.version || 'Unknown',
        message: 'Connected successfully to Sappho audiobook server.',
      };
    } catch (error) {
      return {
        success: false,
        error: `Connection failed: ${error.message}`,
      };
    }
  }

  async getLibraries() {
    // Sappho doesn't have a libraries endpoint, return a default library
    return [{
      id: 'sappho-default',
      name: 'Audiobooks',
      type: 'audiobook',
      itemCount: 0,
    }];
  }

  /**
   * Get active streams from Sappho's session tracking
   * This now uses the /api/sessions endpoint similar to Plex
   */
  async getActiveStreams() {
    const response = await this.client.get('/api/sessions');
    const sessions = response.data.sessions || [];

    const activeStreams = [];

    console.log(`📊 Found ${sessions.length} active Sappho session(s)`);

    for (const session of sessions) {
      const activity = this.parseSessionToActivity(session);
      if (activity) {
        activeStreams.push(activity);
      }
    }

    // OpsDec's monitor.js will handle session lifecycle (like Plex/Emby)
    // No need for manual cleanup - sessions not in this list will be auto-stopped
    return activeStreams;
  }

  /**
   * Parse Sappho session to opsdec activity format
   * Now with proper user, codec, and metadata information
   */
  parseSessionToActivity(session) {
    try {
      // Detect LAN/WAN based on IP address
      const ipAddress = session.ipAddress || null;
      let location = null;

      if (ipAddress) {
        // Check if it's a private IP (LAN)
        const isPrivate = this.isPrivateIP(ipAddress);
        location = isPrivate ? 'lan' : 'wan';
      }

      // Sappho API returns duration and position in seconds (not milliseconds)
      // Validate and ensure we have reasonable values
      let duration = session.duration ? Math.round(session.duration) : null;
      let currentTime = session.position ? Math.round(session.position) : 0;

      // If duration seems unreasonably large (> 100 hours), it might be in milliseconds
      // Convert to seconds in that case
      if (duration && duration > 360000) {
        console.log(`⚠️ Sappho: Large duration detected (${duration}), assuming milliseconds - converting to seconds`);
        duration = Math.round(duration / 1000);
        currentTime = Math.round(currentTime / 1000);
      }

      // Calculate progress percent if not provided
      let progressPercent = session.progressPercent || 0;
      if (!progressPercent && duration && currentTime) {
        progressPercent = Math.round((currentTime / duration) * 100);
      }

      // Determine state - Sappho may use different conventions
      // Check for explicit state field, or paused/isPaused boolean fields
      let state = 'playing';
      if (session.state) {
        state = session.state;
      } else if (session.paused === true || session.isPaused === true) {
        state = 'paused';
      } else if (session.stopped === true || session.isStopped === true) {
        state = 'stopped';
      }

      // Debug logging to help diagnose state issues
      console.log(`   📊 Sappho session ${session.sessionId}: state=${state} (raw: state=${session.state}, paused=${session.paused}, isPaused=${session.isPaused}), pos=${currentTime}/${duration}`);

      return {
        sessionKey: session.sessionId,
        userId: session.userId ? session.userId.toString() : 'unknown',
        username: session.username || 'Sappho User',
        userThumb: null, // Sappho doesn't have user avatars yet
        mediaType: 'audiobook',
        mediaId: session.audiobookId.toString(),
        title: session.title || 'Unknown Title',
        parentTitle: session.series || null,
        grandparentTitle: null,
        seasonNumber: session.seriesPosition || null,
        episodeNumber: null,
        year: session.year || null,
        // Cover art URL - use API token in query param for compatibility
        thumb: session.audiobookId ? `${this.baseUrl}/api/audiobooks/${session.audiobookId}/cover` : null,
        art: null,
        state: state, // 'playing', 'paused', 'stopped'
        progressPercent: progressPercent,
        duration: duration,
        currentTime: currentTime,
        // Client information
        clientName: session.clientName || 'Sappho Web Player',
        deviceName: session.platform || 'Web',
        platform: session.platform || 'Web',
        // Media info with proper codec detection
        bitrate: session.bitrate ? `${(session.bitrate / 1000).toFixed(2)}` : null, // Convert to Mbps
        transcoding: false, // Sappho doesn't transcode
        videoCodec: null,
        audioCodec: session.audioCodec || 'unknown',
        container: session.container || 'unknown',
        resolution: null,
        audioChannels: null,
        // Location info
        ipAddress: ipAddress,
        location: location,
      };
    } catch (error) {
      console.error('Error parsing Sappho session to activity:', error.message);
      return null;
    }
  }

  /**
   * Check if an IP address is private/local
   */
  isPrivateIP(ip) {
    if (!ip) return true;

    const privateRanges = [
      /^127\./,          // 127.0.0.0/8 (localhost)
      /^10\./,           // 10.0.0.0/8 (private)
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (private)
      /^192\.168\./,     // 192.168.0.0/16 (private)
      /^::1$/,           // IPv6 localhost
      /^fe80:/,          // IPv6 link-local
      /^fc00:/,          // IPv6 unique local
    ];

    return privateRanges.some(range => range.test(ip));
  }


  /**
   * WebSocket connection for real-time notifications
   * Similar to Plex WebSocket implementation
   */
  connectWebSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('🔌 Sappho WebSocket already connected');
      return;
    }

    try {
      // Convert HTTP/HTTPS URL to WS/WSS
      const wsUrl = this.baseUrl
        .replace('http://', 'ws://')
        .replace('https://', 'wss://');

      const wsEndpoint = `${wsUrl}/ws/notifications?token=${this.apiKey}`;

      console.log('🔌 Connecting to Sappho WebSocket...');
      this.ws = new WebSocket(wsEndpoint, {
        rejectUnauthorized: false, // Allow self-signed certificates
      });

      this.ws.on('open', () => {
        console.log('✅ Sappho WebSocket connected');
        this.wsConnected = true;
        this.wsReconnectAttempts = 0;
        this.wsReconnectDelay = 1000; // Reset delay
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('Error parsing Sappho WebSocket message:', error.message);
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ Sappho WebSocket error:', error.message);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`🔌 Sappho WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
        this.wsConnected = false;
        this.ws = null;
        this.scheduleReconnect();
      });

    } catch (error) {
      console.error('Error creating Sappho WebSocket:', error.message);
      this.scheduleReconnect();
    }
  }

  handleWebSocketMessage(message) {
    try {
      const { type, session } = message;

      // Filter for session-related message types
      const interestingTypes = ['session.start', 'session.update', 'session.pause', 'session.stop'];
      if (!interestingTypes.includes(type)) {
        return;
      }

      console.log(`📡 Sappho WebSocket: ${type} - ${session?.audiobook?.title || 'Unknown'}`);

      // Notify all registered event handlers
      for (const handler of this.wsEventHandlers) {
        try {
          handler(type, message);
        } catch (error) {
          console.error('Error in Sappho WebSocket event handler:', error.message);
        }
      }
    } catch (error) {
      console.error('Error handling Sappho WebSocket message:', error);
    }
  }

  scheduleReconnect() {
    if (this.wsReconnectAttempts >= this.wsMaxReconnectAttempts) {
      console.error(`❌ Sappho WebSocket max reconnection attempts (${this.wsMaxReconnectAttempts}) reached`);
      return;
    }

    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
    }

    const delay = Math.min(this.wsReconnectDelay * Math.pow(2, this.wsReconnectAttempts), 60000);
    console.log(`🔌 Sappho WebSocket reconnecting in ${delay / 1000}s...`);

    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectAttempts++;
      this.connectWebSocket();
    }, delay);
  }

  disconnectWebSocket() {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.wsConnected = false;
  }

  /**
   * Register an event handler for WebSocket messages
   */
  onWebSocketEvent(handler) {
    this.wsEventHandlers.push(handler);
  }

  /**
   * Check if WebSocket is connected
   */
  isWebSocketConnected() {
    return this.wsConnected;
  }
}

export default SapphoService;
