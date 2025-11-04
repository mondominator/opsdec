import express from 'express';
import db from '../database/init.js';
import { embyService, audiobookshelfService } from '../services/monitor.js';

const router = express.Router();

// Get current activity
router.get('/activity', (req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT
        s.*,
        (SELECT thumb FROM users WHERE username = s.username AND thumb IS NOT NULL LIMIT 1) as user_thumb
      FROM sessions s
      WHERE state IN ('playing', 'paused', 'buffering')
      ORDER BY started_at DESC
    `).all();

    res.json({ success: true, data: sessions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get watch history
router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const userId = req.query.user_id;

    // Get all history entries
    let query = `
      SELECT
        h.*,
        (SELECT thumb FROM users WHERE username = h.username AND thumb IS NOT NULL LIMIT 1) as user_thumb,
        CAST(h.duration * h.percent_complete / 100 AS INTEGER) as session_duration
      FROM history h
      ${userId ? 'WHERE h.user_id = ?' : ''}
      ORDER BY h.watched_at DESC
      LIMIT ? OFFSET ?
    `;

    const params = userId ? [userId, limit, offset] : [limit, offset];
    const history = db.prepare(query).all(...params);

    // Count all entries
    const countQuery = userId
      ? db.prepare('SELECT COUNT(*) as total FROM history WHERE user_id = ?').get(userId)
      : db.prepare('SELECT COUNT(*) as total FROM history').get();

    res.json({
      success: true,
      data: history,
      pagination: {
        limit,
        offset,
        total: countQuery.total,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete history item
router.delete('/history/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM history WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'History item not found' });
    }

    res.json({ success: true, message: 'History item deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get users
router.get('/users', (req, res) => {
  try {
    // Get unique usernames with their most recent activity and avatar
    const uniqueUsers = db.prepare(`
      SELECT
        username,
        MAX(last_seen) as last_seen,
        MAX(is_admin) as is_admin,
        (SELECT thumb FROM users WHERE username = u.username AND thumb IS NOT NULL LIMIT 1) as thumb,
        (SELECT id FROM users WHERE username = u.username LIMIT 1) as id
      FROM users u
      GROUP BY username
      ORDER BY last_seen DESC
    `).all();

    // Enhance each user with additional stats
    const enhancedUsers = uniqueUsers.map(user => {
      // Get watch stats (video content)
      const watchStats = db.prepare(`
        SELECT
          COUNT(*) as watch_plays,
          SUM(duration) as watch_duration
        FROM history
        WHERE username = ? AND media_type IN ('movie', 'episode')
      `).get(user.username);

      // Get listening stats (audio content)
      const listenStats = db.prepare(`
        SELECT
          COUNT(*) as listen_plays,
          SUM(duration) as listen_duration
        FROM history
        WHERE username = ? AND media_type IN ('audiobook', 'track', 'book')
      `).get(user.username);

      // Get total stats
      const totalStats = db.prepare(`
        SELECT
          COUNT(*) as total_plays,
          SUM(duration) as total_duration
        FROM history
        WHERE username = ?
      `).get(user.username);

      // Get server breakdown
      const serverStats = db.prepare(`
        SELECT
          server_type,
          COUNT(*) as plays,
          SUM(duration) as duration
        FROM history
        WHERE username = ?
        GROUP BY server_type
      `).all(user.username);

      return {
        ...user,
        total_plays: totalStats.total_plays || 0,
        total_duration: totalStats.total_duration || 0,
        watch_plays: watchStats.watch_plays || 0,
        watch_duration: watchStats.watch_duration || 0,
        listen_plays: listenStats.listen_plays || 0,
        listen_duration: listenStats.listen_duration || 0,
        server_stats: serverStats
      };
    });

    res.json({ success: true, data: enhancedUsers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user stats
router.get('/users/:userId/stats', (req, res) => {
  try {
    const { userId } = req.params;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Get play counts by media type
    const mediaTypes = db.prepare(`
      SELECT media_type, COUNT(*) as count
      FROM history
      WHERE user_id = ?
      GROUP BY media_type
    `).all(userId);

    // Get recent watches
    const recentWatches = db.prepare(`
      SELECT * FROM history
      WHERE user_id = ?
      ORDER BY watched_at DESC
      LIMIT 10
    `).all(userId);

    // Get most watched
    const mostWatched = db.prepare(`
      SELECT title, parent_title, media_type, COUNT(*) as plays
      FROM history
      WHERE user_id = ?
      GROUP BY media_id
      ORDER BY plays DESC
      LIMIT 10
    `).all(userId);

    res.json({
      success: true,
      data: {
        user,
        mediaTypes,
        recentWatches,
        mostWatched,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get dashboard stats
router.get('/stats/dashboard', (req, res) => {
  try {
    const totalPlays = db.prepare('SELECT COUNT(*) as count FROM history').get();
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const totalDuration = db.prepare('SELECT SUM(total_duration) as total FROM users').get();
    const activeSessions = db.prepare(`
      SELECT COUNT(*) as count FROM sessions
      WHERE state IN ('playing', 'paused')
    `).get();

    // Plays by day (last 30 days)
    const playsByDay = db.prepare(`
      SELECT
        DATE(watched_at, 'unixepoch') as date,
        COUNT(*) as plays
      FROM history
      WHERE watched_at > strftime('%s', 'now', '-30 days')
      GROUP BY date
      ORDER BY date ASC
    `).all();

    // Calculate averages
    const thirtyDayTotal = db.prepare(`
      SELECT COUNT(*) as count FROM history
      WHERE watched_at > strftime('%s', 'now', '-30 days')
    `).get();
    const monthlyAverage = playsByDay.length > 0 ? Math.round(thirtyDayTotal.count / 30) : 0;

    const sevenDayTotal = db.prepare(`
      SELECT COUNT(*) as count FROM history
      WHERE watched_at > strftime('%s', 'now', '-7 days')
    `).get();
    const weeklyAverage = sevenDayTotal.count > 0 ? Math.round(sevenDayTotal.count / 7) : 0;

    const oneDayTotal = db.prepare(`
      SELECT COUNT(*) as count FROM history
      WHERE watched_at > strftime('%s', 'now', '-1 day')
    `).get();
    const dailyAverage = oneDayTotal.count;

    // Average active monthly users (unique users in last 30 days)
    const activeMonthlyUsers = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM history
      WHERE watched_at > strftime('%s', 'now', '-30 days')
    `).get();

    // Peak day of week (0 = Sunday, 6 = Saturday)
    const peakDayResult = db.prepare(`
      SELECT
        CASE CAST(strftime('%w', watched_at, 'unixepoch') AS INTEGER)
          WHEN 0 THEN 'Sunday'
          WHEN 1 THEN 'Monday'
          WHEN 2 THEN 'Tuesday'
          WHEN 3 THEN 'Wednesday'
          WHEN 4 THEN 'Thursday'
          WHEN 5 THEN 'Friday'
          WHEN 6 THEN 'Saturday'
        END as day_name,
        COUNT(*) as count
      FROM history
      WHERE watched_at > strftime('%s', 'now', '-30 days')
      GROUP BY strftime('%w', watched_at, 'unixepoch')
      ORDER BY count DESC
      LIMIT 1
    `).get();
    const peakDay = peakDayResult ? peakDayResult.day_name : 'N/A';

    // Peak hour (0-23)
    const peakHourResult = db.prepare(`
      SELECT
        strftime('%H', watched_at, 'unixepoch', 'localtime') as hour,
        COUNT(*) as count
      FROM history
      WHERE watched_at > strftime('%s', 'now', '-30 days')
      GROUP BY hour
      ORDER BY count DESC
      LIMIT 1
    `).get();
    const peakHour = peakHourResult ? `${parseInt(peakHourResult.hour)}:00` : 'N/A';

    // Top watchers (video content: movies + episodes)
    const topWatchers = db.prepare(`
      SELECT
        h.username,
        SUM(h.duration) as total_duration,
        (SELECT thumb FROM users WHERE username = h.username AND thumb IS NOT NULL LIMIT 1) as thumb
      FROM history h
      WHERE h.media_type IN ('movie', 'episode')
      GROUP BY h.username
      ORDER BY total_duration DESC
      LIMIT 10
    `).all();

    // Top listeners (audio content: audiobooks + tracks + books)
    const topListeners = db.prepare(`
      SELECT
        h.username,
        SUM(h.duration) as total_duration,
        (SELECT thumb FROM users WHERE username = h.username AND thumb IS NOT NULL LIMIT 1) as thumb
      FROM history h
      WHERE h.media_type IN ('audiobook', 'track', 'book')
      GROUP BY h.username
      ORDER BY total_duration DESC
      LIMIT 10
    `).all();

    // Most watched media - split by type (based on unique users)
    const mostWatchedMovies = db.prepare(`
      SELECT title, parent_title, media_type, thumb, media_id, COUNT(DISTINCT user_id) as plays
      FROM history
      WHERE media_type = 'movie'
      GROUP BY media_id
      ORDER BY plays DESC
      LIMIT 10
    `).all();

    const mostWatchedEpisodes = db.prepare(`
      SELECT
        grandparent_title as title,
        media_type,
        thumb,
        grandparent_title as media_id,
        COUNT(DISTINCT user_id) as plays
      FROM history
      WHERE media_type = 'episode' AND grandparent_title IS NOT NULL
      GROUP BY grandparent_title
      ORDER BY plays DESC
      LIMIT 10
    `).all();

    const mostWatchedAudiobooks = db.prepare(`
      SELECT title, parent_title, media_type, thumb, media_id, COUNT(DISTINCT user_id) as plays
      FROM history
      WHERE media_type IN ('audiobook', 'track', 'book')
      GROUP BY media_id
      ORDER BY plays DESC
      LIMIT 10
    `).all();

    // Add users list to each item
    const addUsers = (items) => {
      return items.map(item => {
        const users = db.prepare(`
          SELECT DISTINCT username,
          (SELECT thumb FROM users WHERE username = h.username AND thumb IS NOT NULL LIMIT 1) as thumb
          FROM history h
          WHERE media_id = ? OR grandparent_title = ?
        `).all(item.media_id, item.title);
        return { ...item, users };
      });
    };

    const mostWatchedMoviesWithUsers = addUsers(mostWatchedMovies);
    const mostWatchedEpisodesWithUsers = addUsers(mostWatchedEpisodes);
    const mostWatchedAudiobooksWithUsers = addUsers(mostWatchedAudiobooks);

    res.json({
      success: true,
      data: {
        totalPlays: totalPlays.count,
        totalUsers: totalUsers.count,
        totalDuration: totalDuration.total || 0,
        activeSessions: activeSessions.count,
        monthlyAverage,
        weeklyAverage,
        dailyAverage,
        activeMonthlyUsers: activeMonthlyUsers.count,
        peakDay,
        peakHour,
        playsByDay,
        topWatchers,
        topListeners,
        mostWatchedMovies: mostWatchedMoviesWithUsers,
        mostWatchedEpisodes: mostWatchedEpisodesWithUsers,
        mostWatchedAudiobooks: mostWatchedAudiobooksWithUsers,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recently added media (if Emby is configured)
router.get('/media/recent', async (req, res) => {
  try {
    if (!embyService) {
      return res.status(503).json({
        success: false,
        error: 'Emby service not configured',
      });
    }

    const limit = parseInt(req.query.limit || '20', 10);
    const recent = await embyService.getRecentlyAdded(limit);

    res.json({ success: true, data: recent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Emby connection
router.get('/emby/test', async (req, res) => {
  try {
    if (!embyService) {
      return res.status(503).json({
        success: false,
        error: 'Emby service not configured',
      });
    }

    const result = await embyService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Emby libraries
router.get('/emby/libraries', async (req, res) => {
  try {
    if (!embyService) {
      return res.status(503).json({
        success: false,
        error: 'Emby service not configured',
      });
    }

    const libraries = await embyService.getLibraries();
    res.json({ success: true, data: libraries });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Audiobookshelf connection
router.get('/audiobookshelf/test', async (req, res) => {
  try {
    if (!audiobookshelfService) {
      return res.status(503).json({
        success: false,
        error: 'Audiobookshelf service not configured',
      });
    }

    const result = await audiobookshelfService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Audiobookshelf libraries
router.get('/audiobookshelf/libraries', async (req, res) => {
  try {
    if (!audiobookshelfService) {
      return res.status(503).json({
        success: false,
        error: 'Audiobookshelf service not configured',
      });
    }

    const libraries = await audiobookshelfService.getLibraries();
    res.json({ success: true, data: libraries });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Server Configuration Endpoints
// Get all servers (including environment variable servers)
router.get('/servers', (req, res) => {
  try {
    const dbServers = db.prepare('SELECT * FROM servers ORDER BY created_at ASC').all();

    // Add environment variable servers if they exist and aren't in the database
    const envServers = [];

    // Check Plex
    if (process.env.PLEX_URL && process.env.PLEX_TOKEN) {
      const existingPlex = dbServers.find(s => s.type === 'plex' && s.url === process.env.PLEX_URL);
      if (!existingPlex) {
        envServers.push({
          id: 'env-plex',
          type: 'plex',
          name: 'Plex (Environment)',
          url: process.env.PLEX_URL,
          api_key: '***', // Masked for security
          enabled: 1,
          from_env: true,
          created_at: null,
          updated_at: null
        });
      }
    }

    // Check Emby
    if (process.env.EMBY_URL && process.env.EMBY_API_KEY) {
      const existingEmby = dbServers.find(s => s.type === 'emby' && s.url === process.env.EMBY_URL);
      if (!existingEmby) {
        envServers.push({
          id: 'env-emby',
          type: 'emby',
          name: 'Emby (Environment)',
          url: process.env.EMBY_URL,
          api_key: '***', // Masked for security
          enabled: 1,
          from_env: true,
          created_at: null,
          updated_at: null
        });
      }
    }

    // Check Audiobookshelf
    if (process.env.AUDIOBOOKSHELF_URL && process.env.AUDIOBOOKSHELF_TOKEN) {
      const existingABS = dbServers.find(s => s.type === 'audiobookshelf' && s.url === process.env.AUDIOBOOKSHELF_URL);
      if (!existingABS) {
        envServers.push({
          id: 'env-audiobookshelf',
          type: 'audiobookshelf',
          name: 'Audiobookshelf (Environment)',
          url: process.env.AUDIOBOOKSHELF_URL,
          api_key: '***', // Masked for security
          enabled: 1,
          from_env: true,
          created_at: null,
          updated_at: null
        });
      }
    }

    const allServers = [...envServers, ...dbServers];
    res.json({ success: true, data: allServers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get server health status
router.get('/servers/health', (req, res) => {
  try {
    const servers = db.prepare('SELECT id, type, name, enabled FROM servers').all();
    const health = servers.map(server => {
      // Check if server has had recent activity (within last 5 minutes)
      const recentActivity = db.prepare(`
        SELECT COUNT(*) as count FROM sessions
        WHERE server_type = ? AND updated_at > ?
      `).get(server.type, Math.floor(Date.now() / 1000) - 300);

      return {
        id: server.id,
        type: server.type,
        name: server.name,
        enabled: server.enabled,
        healthy: server.enabled === 1 && recentActivity.count > 0
      };
    });

    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test server connection - MUST come before parameterized routes like /servers/:id
router.post('/servers/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    let server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);

    // Check if this is an environment variable server
    if (!server && id.startsWith('env-')) {
      const envType = id.replace('env-', '');

      if (envType === 'plex' && process.env.PLEX_URL && process.env.PLEX_TOKEN) {
        server = {
          type: 'plex',
          url: process.env.PLEX_URL,
          api_key: process.env.PLEX_TOKEN
        };
      } else if (envType === 'emby' && process.env.EMBY_URL && process.env.EMBY_API_KEY) {
        server = {
          type: 'emby',
          url: process.env.EMBY_URL,
          api_key: process.env.EMBY_API_KEY
        };
      } else if (envType === 'audiobookshelf' && process.env.AUDIOBOOKSHELF_URL && process.env.AUDIOBOOKSHELF_TOKEN) {
        server = {
          type: 'audiobookshelf',
          url: process.env.AUDIOBOOKSHELF_URL,
          api_key: process.env.AUDIOBOOKSHELF_TOKEN
        };
      }
    }

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Dynamically import and test the appropriate service
    let ServiceClass;
    if (server.type === 'emby') {
      const { default: EmbyService } = await import('../services/emby.js');
      ServiceClass = EmbyService;
    } else if (server.type === 'plex') {
      const { default: PlexService } = await import('../services/plex.js');
      ServiceClass = PlexService;
    } else if (server.type === 'audiobookshelf') {
      const { default: AudiobookshelfService } = await import('../services/audiobookshelf.js');
      ServiceClass = AudiobookshelfService;
    } else {
      return res.status(400).json({ success: false, error: 'Invalid server type' });
    }

    const service = new ServiceClass(server.url, server.api_key);
    const result = await service.testConnection();

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a new server
router.post('/servers', (req, res) => {
  try {
    const { type, name, url, api_key, enabled } = req.body;

    if (!type || !name || !url || !api_key) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: type, name, url, api_key'
      });
    }

    const id = `${type}-${Date.now()}`;
    const now = Math.floor(Date.now() / 1000);

    db.prepare(`
      INSERT INTO servers (id, type, name, url, api_key, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, name, url, api_key, enabled !== false ? 1 : 0, now, now);

    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    res.json({ success: true, data: server });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update a server
router.put('/servers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { type, name, url, api_key, enabled } = req.body;

    const existing = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    const now = Math.floor(Date.now() / 1000);

    db.prepare(`
      UPDATE servers
      SET type = ?, name = ?, url = ?, api_key = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      type || existing.type,
      name || existing.name,
      url || existing.url,
      api_key || existing.api_key,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      now,
      id
    );

    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    res.json({ success: true, data: server });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a server
router.delete('/servers/:id', (req, res) => {
  try {
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    db.prepare('DELETE FROM servers WHERE id = ?').run(id);
    res.json({ success: true, message: 'Server deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Restart monitoring service
router.post('/monitoring/restart', async (req, res) => {
  try {
    const { restartMonitoring } = await import('../services/monitor.js');
    await restartMonitoring();
    res.json({ success: true, message: 'Monitoring service restarted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Application Settings Endpoints
// Get all settings
router.get('/settings', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings').all();
    const settingsObj = {};
    settings.forEach(setting => {
      settingsObj[setting.key] = setting.value;
    });

    // Return defaults if settings don't exist
    res.json({
      success: true,
      data: {
        timezone: settingsObj.timezone || 'UTC',
        ...settingsObj
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update a setting
router.put('/settings/:key', (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (!value) {
      return res.status(400).json({ success: false, error: 'Value is required' });
    }

    // Insert or replace setting
    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, strftime('%s', 'now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = strftime('%s', 'now')
    `).run(key, value);

    res.json({ success: true, message: 'Setting updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
