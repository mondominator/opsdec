import axios from 'axios';

class SeerrService {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-Api-Key': this.apiKey,
      },
    });
  }

  async testConnection() {
    try {
      const response = await this.client.get('/api/v1/settings/main');
      return {
        success: true,
        serverName: response.data.applicationTitle || 'Seerr',
        version: response.data.applicationUrl || '',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getRecentRequests(limit = 5) {
    const response = await this.client.get('/api/v1/request', {
      params: { take: limit, sort: 'added', skip: 0 },
    });

    const requests = response.data.results || [];

    // Fetch titles in parallel for each request
    const enriched = await Promise.all(
      requests.map(async (req) => {
        const media = req.media || {};
        const mediaType = media.mediaType; // 'movie' or 'tv'
        const tmdbId = media.tmdbId;

        let title = 'Unknown';
        let year = null;
        let posterPath = media.posterPath || null;

        if (tmdbId && mediaType) {
          try {
            const endpoint = mediaType === 'movie'
              ? `/api/v1/movie/${tmdbId}`
              : `/api/v1/tv/${tmdbId}`;
            const detail = await this.client.get(endpoint);

            if (mediaType === 'movie') {
              title = detail.data.title || title;
              year = detail.data.releaseDate ? detail.data.releaseDate.substring(0, 4) : null;
            } else {
              title = detail.data.name || title;
              year = detail.data.firstAirDate ? detail.data.firstAirDate.substring(0, 4) : null;
            }
            posterPath = detail.data.posterPath || posterPath;
          } catch {
            // If detail fetch fails, use what we have
          }
        }

        const posterUrl = posterPath
          ? `https://image.tmdb.org/t/p/w300${posterPath}`
          : null;

        const requestedBy = req.requestedBy || {};

        return {
          id: req.id,
          title,
          type: mediaType || 'movie',
          year,
          posterUrl,
          requestedBy: {
            username: requestedBy.displayName || requestedBy.username || requestedBy.plexUsername || 'Unknown',
            avatar: requestedBy.avatar || null,
          },
          status: req.status,
          createdAt: req.createdAt,
        };
      })
    );

    return enriched;
  }

  async getUsers() {
    const response = await this.client.get('/api/v1/user', {
      params: { take: 100 },
    });

    const users = response.data.results || [];
    return users.map((user) => ({
      id: user.id,
      username: user.displayName || user.username || user.plexUsername || 'Unknown',
      plexUsername: user.plexUsername || null,
      avatar: user.avatar || null,
    }));
  }
}

export default SeerrService;
