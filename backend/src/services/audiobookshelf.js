import axios from 'axios';
import https from 'https';

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
  }

  async testConnection() {
    try {
      const response = await this.client.get('/api/status');
      return {
        success: true,
        serverName: 'Audiobookshelf',
        version: response.data.serverVersion || 'Unknown',
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
        duration: session.duration || null,
        currentTime: session.currentTime || 0,
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
      // Try to get currently playing sessions from the /api/me/listening-sessions endpoint
      // This should give us active/current playback sessions
      try {
        const currentResponse = await this.client.get('/api/me/listening-sessions');
        if (currentResponse.data && currentResponse.data.length > 0) {
          console.log(`Found ${currentResponse.data.length} currently listening sessions`);
          return currentResponse.data;
        }
      } catch (currentError) {
        console.log('No /api/me/listening-sessions endpoint, falling back to open sessions');
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

  async getActivePlaybackSessions() {
    try {
      const sessions = await this.getPlaybackSessions();
      const activeStreams = [];

      const now = Date.now();
      const thirtySecondsAgo = now - (30 * 1000); // 30 seconds ago

      // For Audiobookshelf, filter for sessions updated in the last 30 seconds
      // This ensures we only show truly active playback, not paused sessions
      const activeSessions = Array.isArray(sessions)
        ? sessions.filter(s => {
            return s &&
                   s.libraryItemId &&
                   s.currentTime !== undefined &&
                   s.updatedAt &&
                   s.updatedAt > thirtySecondsAgo;
          })
        : [];

      console.log(`Found ${activeSessions.length} active Audiobookshelf sessions out of ${sessions.length} total open sessions (updated within last 30 seconds)`);

      for (const session of activeSessions) {
        const activity = this.parsePlaybackSession(session);
        if (activity) {
          activeStreams.push(activity);
        }
      }

      return activeStreams;
    } catch (error) {
      console.error('Error getting active playback sessions:', error.message);
      return [];
    }
  }

  parsePlaybackSession(session) {
    try {
      // Use the direct session data structure from Audiobookshelf API
      const metadata = session.mediaMetadata || {};
      const seriesName = metadata.series?.[0]?.name || null;

      // Ensure required fields are present
      if (!session.id || !session.userId || !session.libraryItemId) {
        return null;
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
        state: session.currentTime > 0 ? 'playing' : 'paused',
        progressPercent: session.duration
          ? Math.round((session.currentTime / session.duration) * 100)
          : 0,
        duration: session.duration || null,
        currentTime: session.currentTime || 0,
        clientName: session.deviceInfo?.clientName || 'Audiobookshelf',
        deviceName: session.deviceInfo?.deviceName || 'Unknown Device',
        platform: 'Audiobookshelf',
        bitrate: null,
        transcoding: false,
        videoCodec: null,
        audioCodec: null,
        container: null,
        resolution: null,
      };
    } catch (error) {
      console.error('Error parsing Audiobookshelf playback session:', error.message);
      return null;
    }
  }
}

export default AudiobookshelfService;
