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

  async getActivePlaybackSessions() {
    try {
      const sessions = await this.getPlaybackSessions();
      const activeStreams = [];

      const now = Date.now();
      const fiveMinutesAgo = now - (5 * 60 * 1000); // 5 minutes ago

      // For Audiobookshelf, filter for sessions updated recently
      // Since we're now checking users with active playback first,
      // we can use a tighter window
      const activeSessions = Array.isArray(sessions)
        ? sessions.filter(s => {
            if (!s || !s.libraryItemId || s.currentTime === undefined) {
              return false;
            }
            // If updatedAt is not present, include the session (assume it's active)
            // Otherwise, check if it was updated within the last 5 minutes
            if (!s.updatedAt) {
              return true;
            }
            return s.updatedAt > fiveMinutesAgo;
          })
        : [];

      console.log(`Found ${activeSessions.length} active Audiobookshelf sessions out of ${sessions.length} total sessions (updated within last 5 minutes)`);

      for (const session of activeSessions) {
        const activity = await this.parsePlaybackSession(session);
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
        bitrate: bitrate,
        transcoding: false,
        videoCodec: null,
        audioCodec: audioCodec,
        container: container,
        resolution: null,
        audioChannels: channels,
      };
    } catch (error) {
      console.error('Error parsing Audiobookshelf playback session:', error.message);
      return null;
    }
  }
}

export default AudiobookshelfService;
