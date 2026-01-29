import express from 'express';
import db from '../database/init.js';
import { embyService, audiobookshelfService, sapphoService, jellyfinService } from '../services/monitor.js';
import { getJobs, runJob, updateJob } from '../services/jobs.js';
import multer from 'multer';

const router = express.Router();

// Configure multer for backup file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const path = await import('path');
    const dbPath = process.env.DATABASE_PATH || './data/opsdec.db';
    const dataDir = path.dirname(dbPath);
    cb(null, dataDir);
  },
  filename: (req, file, cb) => {
    // Generate filename with timestamp
    cb(null, `opsdec_backup_${Date.now()}.db`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Only accept .db files
    if (file.originalname.endsWith('.db')) {
      cb(null, true);
    } else {
      cb(new Error('Only .db files are allowed'));
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

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

    // Prevent caching to ensure fresh session data
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

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
        h.id,
        h.session_id,
        h.server_type,
        h.user_id,
        h.username,
        h.media_type,
        h.media_id,
        h.title,
        h.parent_title,
        h.grandparent_title,
        h.watched_at,
        CAST(h.duration AS INTEGER) as duration,
        h.percent_complete,
        h.thumb,
        CAST(h.stream_duration AS INTEGER) as stream_duration,
        h.ip_address,
        h.location,
        h.city,
        h.region,
        h.country,
        (SELECT thumb FROM users WHERE username = h.username AND server_type = h.server_type AND thumb IS NOT NULL LIMIT 1) as user_thumb,
        CAST(h.duration * h.percent_complete / 100 AS INTEGER) as session_duration
      FROM history h
      ${userId ? 'WHERE h.user_id = ?' : ''}
      ORDER BY h.watched_at DESC
      LIMIT ? OFFSET ?
    `;

    const params = userId ? [userId, limit, offset] : [limit, offset];
    const historyRaw = db.prepare(query).all(...params);

    // Apply user mappings and get correct avatars
    const history = historyRaw.map(item => {
      const primaryUsername = applyUserMapping(item.username, item.server_type);
      const avatarInfo = getAvatarForPrimaryUser(primaryUsername);
      return {
        ...item,
        username: primaryUsername,
        user_thumb: avatarInfo ? avatarInfo.thumb : null,
        user_server_type: avatarInfo ? avatarInfo.server_type : item.server_type
      };
    });

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

    // Get the history item first to save its ABS session IDs (prevents re-import)
    const historyItem = db.prepare('SELECT title, server_type, abs_session_ids FROM history WHERE id = ?').get(id);

    if (!historyItem) {
      return res.status(404).json({ success: false, error: 'History item not found' });
    }

    // If this is an Audiobookshelf entry with session IDs, save them to ignored list
    if (historyItem.server_type === 'audiobookshelf' && historyItem.abs_session_ids) {
      const sessionIds = historyItem.abs_session_ids.split(',');
      const insertIgnored = db.prepare('INSERT OR IGNORE INTO ignored_abs_sessions (session_id, title) VALUES (?, ?)');
      for (const sessionId of sessionIds) {
        insertIgnored.run(sessionId.trim(), historyItem.title);
      }
    }

    const result = db.prepare('DELETE FROM history WHERE id = ?').run(id);

    res.json({ success: true, message: 'History item deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Repair Audiobookshelf covers - searches by title to find new item IDs for moved books
router.post('/history/repair-covers', async (req, res) => {
  try {
    if (!audiobookshelfService) {
      return res.status(400).json({ success: false, error: 'Audiobookshelf not configured' });
    }

    // Get all Audiobookshelf history entries
    const absHistory = db.prepare(`
      SELECT id, title, media_id, thumb
      FROM history
      WHERE server_type = 'audiobookshelf'
    `).all();

    let repaired = 0;
    let notFound = 0;

    for (const entry of absHistory) {
      // Check if current item exists
      const exists = await audiobookshelfService.itemExists(entry.media_id);
      if (exists) continue;

      // Item doesn't exist, search by title
      const found = await audiobookshelfService.searchByTitle(entry.title);
      if (found) {
        // Update the history entry with new media_id and thumb
        db.prepare(`
          UPDATE history
          SET media_id = ?, thumb = ?
          WHERE id = ?
        `).run(found.id, found.coverUrl, entry.id);
        repaired++;
        console.log(`🔧 Repaired cover for "${entry.title}" - new ID: ${found.id}`);
      } else {
        notFound++;
        console.log(`⚠️ Could not find replacement for "${entry.title}"`);
      }
    }

    res.json({
      success: true,
      message: `Repaired ${repaired} covers, ${notFound} not found`,
      repaired,
      notFound
    });
  } catch (error) {
    console.error('Error repairing covers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Merge duplicate Audiobookshelf history entries (same media_id + user_id)
router.post('/history/merge-duplicates', (req, res) => {
  try {
    // Find duplicates: same media_id + user_id with multiple entries
    const duplicates = db.prepare(`
      SELECT media_id, user_id, COUNT(*) as count
      FROM history
      WHERE server_type = 'audiobookshelf'
      GROUP BY media_id, user_id
      HAVING COUNT(*) > 1
    `).all();

    let merged = 0;

    for (const dup of duplicates) {
      // Get all entries for this book + user
      const entries = db.prepare(`
        SELECT id, title, percent_complete, stream_duration, watched_at, abs_session_ids
        FROM history
        WHERE media_id = ? AND user_id = ? AND server_type = 'audiobookshelf'
        ORDER BY watched_at DESC
      `).all(dup.media_id, dup.user_id);

      if (entries.length <= 1) continue;

      // Keep the most recent entry, merge stats from others
      const keepEntry = entries[0];
      const mergeEntries = entries.slice(1);

      // Calculate merged values
      let totalStreamDuration = keepEntry.stream_duration || 0;
      let maxPercent = keepEntry.percent_complete || 0;
      let allSessionIds = keepEntry.abs_session_ids ? [keepEntry.abs_session_ids] : [];

      for (const entry of mergeEntries) {
        totalStreamDuration += entry.stream_duration || 0;
        maxPercent = Math.max(maxPercent, entry.percent_complete || 0);
        if (entry.abs_session_ids) {
          allSessionIds.push(entry.abs_session_ids);
        }
      }

      // Update the kept entry with merged values
      db.prepare(`
        UPDATE history
        SET stream_duration = ?, percent_complete = ?, abs_session_ids = ?
        WHERE id = ?
      `).run(totalStreamDuration, maxPercent, allSessionIds.join(','), keepEntry.id);

      // Delete the duplicate entries
      const deleteIds = mergeEntries.map(e => e.id);
      db.prepare(`DELETE FROM history WHERE id IN (${deleteIds.map(() => '?').join(',')})`).run(...deleteIds);

      merged++;
      console.log(`🔀 Merged ${entries.length} entries for "${keepEntry.title}" into one`);
    }

    res.json({
      success: true,
      message: `Merged ${merged} sets of duplicates`,
      merged
    });
  } catch (error) {
    console.error('Error merging duplicates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Scheduled Jobs Endpoints
// Get all jobs with status
router.get('/jobs', (req, res) => {
  try {
    const jobs = getJobs();
    res.json({ success: true, data: jobs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Run a job manually
router.post('/jobs/:id/run', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await runJob(id, true); // true = manual run
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update job settings (enable/disable, schedule)
router.patch('/jobs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { enabled, cronSchedule } = req.body;
    const job = updateJob(id, { enabled, cronSchedule });
    res.json({ success: true, data: job });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get users
router.get('/users', (req, res) => {
  try {
    // Get all users with their server_type
    const allUsersRaw = db.prepare(`
      SELECT
        username,
        server_type,
        MAX(last_seen) as last_seen,
        MAX(is_admin) as is_admin,
        id
      FROM users
      GROUP BY username, server_type
      ORDER BY last_seen DESC
    `).all();

    // Apply user mappings and group by primary username
    const usersByPrimary = {};
    allUsersRaw.forEach(user => {
      const primaryUsername = applyUserMapping(user.username, user.server_type);

      if (!usersByPrimary[primaryUsername]) {
        usersByPrimary[primaryUsername] = {
          username: primaryUsername,
          last_seen: user.last_seen,
          is_admin: user.is_admin,
          id: user.id,
          mapped_usernames: []
        };
      } else {
        // Keep the most recent last_seen
        if (user.last_seen > usersByPrimary[primaryUsername].last_seen) {
          usersByPrimary[primaryUsername].last_seen = user.last_seen;
        }
        // Keep is_admin if any mapped user is admin
        if (user.is_admin) {
          usersByPrimary[primaryUsername].is_admin = user.is_admin;
        }
      }

      // Track mapped usernames for stat queries
      usersByPrimary[primaryUsername].mapped_usernames.push({
        username: user.username,
        server_type: user.server_type
      });
    });

    // Enhance each primary user with aggregated stats
    const enhancedUsers = Object.values(usersByPrimary).map(user => {
      // Build WHERE clause for all mapped usernames
      const whereConditions = user.mapped_usernames.map(() =>
        '(username = ? AND server_type = ?)'
      ).join(' OR ');
      const whereParams = user.mapped_usernames.flatMap(m => [m.username, m.server_type]);

      // Get watch stats (video content)
      const watchStats = db.prepare(`
        SELECT
          COUNT(*) as watch_plays,
          CAST(SUM(stream_duration) AS INTEGER) as watch_duration
        FROM history
        WHERE (${whereConditions}) AND media_type IN ('movie', 'episode')
      `).get(...whereParams);

      // Get listening stats (audio content)
      const listenStats = db.prepare(`
        SELECT
          COUNT(*) as listen_plays,
          CAST(SUM(stream_duration) AS INTEGER) as listen_duration
        FROM history
        WHERE (${whereConditions}) AND media_type IN ('audiobook', 'track', 'book')
      `).get(...whereParams);

      // Get total stats
      const totalStats = db.prepare(`
        SELECT
          COUNT(*) as total_plays,
          CAST(SUM(stream_duration) AS INTEGER) as total_duration
        FROM history
        WHERE (${whereConditions})
      `).get(...whereParams);

      // Get server breakdown
      const serverStats = db.prepare(`
        SELECT
          server_type,
          COUNT(*) as plays,
          CAST(SUM(stream_duration) AS INTEGER) as duration
        FROM history
        WHERE (${whereConditions})
        GROUP BY server_type
      `).all(...whereParams);

      // Get the correct avatar for this primary user
      const avatarInfo = getAvatarForPrimaryUser(user.username);

      return {
        id: user.id,
        username: user.username,
        last_seen: user.last_seen,
        is_admin: user.is_admin,
        thumb: avatarInfo ? avatarInfo.thumb : null,
        server_type: avatarInfo ? avatarInfo.server_type : null,
        is_mapped: user.mapped_usernames.length > 1,
        mapped_servers: user.mapped_usernames.length,
        server_types: user.mapped_usernames.map(m => m.server_type), // Array of ALL server types from mapped accounts
        total_plays: totalStats?.total_plays || 0,
        total_duration: totalStats?.total_duration || 0,
        watch_plays: watchStats?.watch_plays || 0,
        watch_duration: watchStats?.watch_duration || 0,
        listen_plays: listenStats?.listen_plays || 0,
        listen_duration: listenStats?.listen_duration || 0,
        server_stats: serverStats
      };
    });

    // Sort by last_seen DESC
    enhancedUsers.sort((a, b) => b.last_seen - a.last_seen);

    res.json({ success: true, data: enhancedUsers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user stats
router.get('/users/:userId/stats', (req, res) => {
  try {
    const { userId } = req.params;

    // First check if this is a user ID (numeric) or a username (string from the new /users endpoint)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Apply user mapping to get the primary username
    const primaryUsername = applyUserMapping(user.username, user.server_type);

    // Get all mapped usernames for this primary username
    const mappedUsers = db.prepare(`
      SELECT u.id, u.username, u.server_type
      FROM users u
      WHERE u.username = ?
      UNION
      SELECT u.id, u.username, u.server_type
      FROM users u
      INNER JOIN user_mappings um ON u.username = um.mapped_username AND u.server_type = um.server_type
      WHERE um.primary_username = ?
    `).all(primaryUsername, primaryUsername);

    // Build list of user IDs to query
    const userIds = mappedUsers.map(u => u.id);
    const userIdsPlaceholders = userIds.map(() => '?').join(',');

    // Get play counts and total duration by media type (aggregated across all mapped users)
    const mediaTypes = db.prepare(`
      SELECT
        media_type,
        COUNT(*) as count,
        CAST(SUM(stream_duration) AS INTEGER) as total_duration
      FROM history
      WHERE user_id IN (${userIdsPlaceholders})
      GROUP BY media_type
    `).all(...userIds);

    // Calculate total plays and duration
    const totalPlays = mediaTypes.reduce((sum, mt) => sum + mt.count, 0);
    const totalDuration = mediaTypes.reduce((sum, mt) => sum + (mt.total_duration || 0), 0);

    // Calculate watch duration (movies + episodes) and listen duration (tracks + audiobooks + books + music)
    const watchTypes = ['movie', 'episode'];
    const listenTypes = ['track', 'audiobook', 'book', 'music'];

    const watchDuration = mediaTypes
      .filter(mt => watchTypes.includes(mt.media_type))
      .reduce((sum, mt) => sum + (mt.total_duration || 0), 0);

    const listenDuration = mediaTypes
      .filter(mt => listenTypes.includes(mt.media_type))
      .reduce((sum, mt) => sum + (mt.total_duration || 0), 0);

    // Get recent watches - deduplicated by media_id, showing only the most recent play of each item
    const recentWatches = db.prepare(`
      SELECT h.*
      FROM history h
      INNER JOIN (
        SELECT media_id, MAX(watched_at) as max_watched_at
        FROM history
        WHERE user_id IN (${userIdsPlaceholders})
        GROUP BY media_id
      ) latest ON h.media_id = latest.media_id AND h.watched_at = latest.max_watched_at
      WHERE h.user_id IN (${userIdsPlaceholders})
      ORDER BY h.watched_at DESC
      LIMIT 10
    `).all(...userIds, ...userIds);

    // Get server breakdown stats
    const serverBreakdown = db.prepare(`
      SELECT
        server_type,
        COUNT(*) as count,
        CAST(SUM(stream_duration) AS INTEGER) as total_duration
      FROM history
      WHERE user_id IN (${userIdsPlaceholders})
      GROUP BY server_type
    `).all(...userIds);

    // Get top streaming locations
    const topLocations = db.prepare(`
      SELECT
        city,
        region,
        country,
        COUNT(*) as count,
        CAST(SUM(stream_duration) AS INTEGER) as total_duration
      FROM history
      WHERE user_id IN (${userIdsPlaceholders})
        AND city IS NOT NULL
        AND city != ''
      GROUP BY city, region, country
      ORDER BY count DESC
      LIMIT 5
    `).all(...userIds);

    // Check if this is a mapped user
    const isMapped = mappedUsers.length > 1;
    const serverTypes = isMapped ? [...new Set(mappedUsers.map(u => u.server_type))] : [user.server_type];

    // Build mapped usernames array with server info
    const mappedUsernames = mappedUsers.map(u => ({
      username: u.username,
      server_type: u.server_type
    }));

    // Return user info with primary username
    const avatarInfo = getAvatarForPrimaryUser(primaryUsername);
    const userInfo = {
      id: user.id,
      username: primaryUsername,
      thumb: avatarInfo ? avatarInfo.thumb : null,
      server_type: avatarInfo ? avatarInfo.server_type : null,
      email: user.email,
      is_admin: user.is_admin,
      history_enabled: user.history_enabled,
      last_seen: user.last_seen,
      total_plays: totalPlays,
      total_duration: totalDuration,
      watch_duration: watchDuration,
      listen_duration: listenDuration,
      is_mapped: isMapped,
      mapped_servers: mappedUsers.length,
      server_types: serverTypes,
      mapped_usernames: mappedUsernames
    };

    res.json({
      success: true,
      data: {
        user: userInfo,
        mediaTypes,
        recentWatches,
        serverBreakdown,
        topLocations,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Toggle user history tracking
router.put('/users/:userId/history-enabled', (req, res) => {
  try {
    const { userId } = req.params;
    const { enabled } = req.body;

    if (enabled === undefined) {
      return res.status(400).json({ success: false, error: 'enabled field is required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    db.prepare('UPDATE users SET history_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, userId);

    res.json({
      success: true,
      message: `History tracking ${enabled ? 'enabled' : 'disabled'} for ${user.username}`
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

    // Calculate watch duration (movies + episodes) and listen duration (tracks + audiobooks + books + music)
    const watchTypes = ['movie', 'episode'];
    const listenTypes = ['track', 'audiobook', 'book', 'music'];

    const watchDurationResult = db.prepare(`
      SELECT SUM(h.stream_duration) as total
      FROM history h
      WHERE h.media_type IN ('movie', 'episode')
    `).get();

    const listenDurationResult = db.prepare(`
      SELECT SUM(h.stream_duration) as total
      FROM history h
      WHERE h.media_type IN ('track', 'audiobook', 'book', 'music')
    `).get();

    const watchDuration = watchDurationResult?.total || 0;
    const listenDuration = listenDurationResult?.total || 0;

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
    const topWatchersRaw = db.prepare(`
      SELECT
        h.username,
        h.server_type,
        CAST(SUM(h.stream_duration) AS INTEGER) as total_duration
      FROM history h
      WHERE h.media_type IN ('movie', 'episode')
      GROUP BY h.username, h.server_type
    `).all();

    // Apply user mappings and aggregate by primary username
    const watchersByPrimary = {};
    topWatchersRaw.forEach(row => {
      const primaryUsername = applyUserMapping(row.username, row.server_type);
      if (!watchersByPrimary[primaryUsername]) {
        watchersByPrimary[primaryUsername] = {
          username: primaryUsername,
          total_duration: 0,
          thumb: null
        };
      }
      watchersByPrimary[primaryUsername].total_duration += row.total_duration;
    });

    // Convert to array and sort
    const topWatchers = Object.values(watchersByPrimary)
      .sort((a, b) => b.total_duration - a.total_duration)
      .slice(0, 10)
      .map(watcher => {
        // Get thumb for the primary username using avatar preference
        const avatarInfo = getAvatarForPrimaryUser(watcher.username);
        return {
          ...watcher,
          user_id: getUserIdForPrimaryUsername(watcher.username),
          thumb: avatarInfo ? avatarInfo.thumb : null,
          server_type: avatarInfo ? avatarInfo.server_type : null
        };
      });

    // Top listeners (audio content: audiobooks + tracks + books + music)
    const topListenersRaw = db.prepare(`
      SELECT
        h.username,
        h.server_type,
        CAST(SUM(h.stream_duration) AS INTEGER) as total_duration
      FROM history h
      WHERE h.media_type IN ('audiobook', 'track', 'book', 'music')
      GROUP BY h.username, h.server_type
    `).all();

    // Apply user mappings and aggregate by primary username
    const listenersByPrimary = {};
    topListenersRaw.forEach(row => {
      const primaryUsername = applyUserMapping(row.username, row.server_type);
      if (!listenersByPrimary[primaryUsername]) {
        listenersByPrimary[primaryUsername] = {
          username: primaryUsername,
          total_duration: 0,
          thumb: null
        };
      }
      listenersByPrimary[primaryUsername].total_duration += row.total_duration;
    });

    // Convert to array and sort
    const topListeners = Object.values(listenersByPrimary)
      .sort((a, b) => b.total_duration - a.total_duration)
      .slice(0, 10)
      .map(listener => {
        // Get thumb for the primary username using avatar preference
        const avatarInfo = getAvatarForPrimaryUser(listener.username);
        return {
          ...listener,
          user_id: getUserIdForPrimaryUsername(listener.username),
          thumb: avatarInfo ? avatarInfo.thumb : null,
          server_type: avatarInfo ? avatarInfo.server_type : null
        };
      });

    // Most watched media - split by type (unique users first, then total plays as tiebreaker)
    const mostWatchedMovies = db.prepare(`
      SELECT
        title,
        MAX(parent_title) as parent_title,
        media_type,
        MAX(thumb) as thumb,
        MAX(media_id) as media_id,
        COUNT(DISTINCT username) as unique_users,
        COUNT(*) as plays
      FROM history
      WHERE media_type = 'movie'
      GROUP BY title
      ORDER BY unique_users DESC, plays DESC
      LIMIT 10
    `).all();

    const mostWatchedEpisodes = db.prepare(`
      SELECT
        grandparent_title as title,
        grandparent_title as media_id,
        media_type,
        MAX(thumb) as thumb,
        COUNT(DISTINCT username) as unique_users,
        COUNT(*) as plays
      FROM history
      WHERE media_type = 'episode' AND grandparent_title IS NOT NULL
      GROUP BY grandparent_title
      ORDER BY unique_users DESC, plays DESC
      LIMIT 10
    `).all();

    const mostWatchedAudiobooks = db.prepare(`
      SELECT
        title,
        MAX(parent_title) as parent_title,
        media_type,
        MAX(thumb) as thumb,
        MAX(media_id) as media_id,
        COUNT(DISTINCT username) as unique_users,
        COUNT(*) as plays
      FROM history
      WHERE media_type IN ('audiobook', 'track', 'book')
      GROUP BY title
      ORDER BY unique_users DESC, plays DESC
      LIMIT 10
    `).all();

    // Add users list to each item
    const addUsers = (items) => {
      return items.map(item => {
        const usersRaw = db.prepare(`
          SELECT DISTINCT h.username, h.server_type,
          (SELECT thumb FROM users WHERE username = h.username AND server_type = h.server_type AND thumb IS NOT NULL LIMIT 1) as thumb
          FROM history h
          WHERE media_id = ? OR grandparent_title = ? OR title = ?
        `).all(item.media_id, item.title, item.title);

        // Apply user mappings and deduplicate by primary username
        const usersByPrimary = {};
        usersRaw.forEach(user => {
          const primaryUsername = applyUserMapping(user.username, user.server_type);
          if (!usersByPrimary[primaryUsername]) {
            usersByPrimary[primaryUsername] = {
              username: primaryUsername,
              thumb: null
            };
          }
        });

        // Get the correct avatar for each primary user
        const users = Object.values(usersByPrimary).map(user => {
          const avatarInfo = getAvatarForPrimaryUser(user.username);
          return {
            ...user,
            user_id: getUserIdForPrimaryUsername(user.username),
            thumb: avatarInfo ? avatarInfo.thumb : null,
            server_type: avatarInfo ? avatarInfo.server_type : null
          };
        });

        return { ...item, users };
      });
    };

    const mostWatchedMoviesWithUsers = addUsers(mostWatchedMovies);
    const mostWatchedEpisodesWithUsers = addUsers(mostWatchedEpisodes);
    const mostWatchedAudiobooksWithUsers = addUsers(mostWatchedAudiobooks);

    // Top streaming locations with users
    const topLocationsRaw = db.prepare(`
      SELECT
        city,
        region,
        country,
        COUNT(*) as streams
      FROM history
      WHERE city IS NOT NULL AND city != 'Unknown'
      GROUP BY city, region, country
      ORDER BY streams DESC
      LIMIT 5
    `).all();

    const topLocations = topLocationsRaw.map(loc => {
      // Get users for this location with their thumbs
      // Handle NULL values properly for region and country
      const locationUsersRaw = db.prepare(`
        SELECT DISTINCT h.username, h.server_type, u.thumb
        FROM history h
        LEFT JOIN users u ON h.username = u.username AND h.server_type = u.server_type
        WHERE h.city = ?
          AND (h.region = ? OR (h.region IS NULL AND ? IS NULL))
          AND (h.country = ? OR (h.country IS NULL AND ? IS NULL))
      `).all(loc.city, loc.region, loc.region, loc.country, loc.country);

      // Apply user mappings and deduplicate by primary username
      const usersByPrimary = {};
      locationUsersRaw.forEach(user => {
        const primaryUsername = applyUserMapping(user.username, user.server_type);
        if (!usersByPrimary[primaryUsername]) {
          usersByPrimary[primaryUsername] = {
            username: primaryUsername,
            thumb: null
          };
        }
      });

      // Get the correct avatar for each primary user
      Object.values(usersByPrimary).forEach(user => {
        const avatarInfo = getAvatarForPrimaryUser(user.username);
        user.user_id = getUserIdForPrimaryUsername(user.username);
        user.thumb = avatarInfo ? avatarInfo.thumb : null;
        user.server_type = avatarInfo ? avatarInfo.server_type : null;
      });

      return {
        ...loc,
        users: Object.values(usersByPrimary)
      };
    });

    res.json({
      success: true,
      data: {
        totalPlays: totalPlays.count,
        totalUsers: totalUsers.count,
        totalDuration: totalDuration.total || 0,
        watchDuration,
        listenDuration,
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
        topLocations,
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

// Get Sappho libraries
router.get('/sappho/libraries', async (req, res) => {
  try {
    if (!sapphoService) {
      return res.status(503).json({
        success: false,
        error: 'Sappho service not configured',
      });
    }

    const libraries = await sapphoService.getLibraries();
    res.json({ success: true, data: libraries });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Jellyfin connection
router.get('/jellyfin/test', async (req, res) => {
  try {
    if (!jellyfinService) {
      return res.status(503).json({
        success: false,
        error: 'Jellyfin service not configured',
      });
    }

    const result = await jellyfinService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Jellyfin libraries
router.get('/jellyfin/libraries', async (req, res) => {
  try {
    if (!jellyfinService) {
      return res.status(503).json({
        success: false,
        error: 'Jellyfin service not configured',
      });
    }

    const libraries = await jellyfinService.getLibraries();
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
      } else if (envType === 'sappho' && process.env.SAPHO_URL && process.env.SAPHO_API_KEY) {
        server = {
          type: 'sappho',
          url: process.env.SAPHO_URL,
          api_key: process.env.SAPHO_API_KEY
        };
      } else if (envType === 'jellyfin' && process.env.JELLYFIN_URL && process.env.JELLYFIN_API_KEY) {
        server = {
          type: 'jellyfin',
          url: process.env.JELLYFIN_URL,
          api_key: process.env.JELLYFIN_API_KEY
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
    } else if (server.type === 'sappho') {
      const { default: SapphoService } = await import('../services/sappho.js');
      ServiceClass = SapphoService;
    } else if (server.type === 'jellyfin') {
      const { default: JellyfinService } = await import('../services/jellyfin.js');
      ServiceClass = JellyfinService;
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

// User Mappings Endpoints
// Helper function to apply user mappings
function applyUserMapping(username, serverType) {
  const mapping = db.prepare('SELECT primary_username FROM user_mappings WHERE mapped_username = ? AND server_type = ?').get(username, serverType);
  return mapping ? mapping.primary_username : username;
}

// Helper function to get user_id for a primary username
function getUserIdForPrimaryUsername(primaryUsername) {
  // First check if it's a mapped user - get the preferred avatar server
  const mapping = db.prepare('SELECT preferred_avatar_server FROM user_mappings WHERE primary_username = ? LIMIT 1').get(primaryUsername);

  if (mapping) {
    // For mapped users, get the mapped username for the preferred avatar server
    const serverMapping = db.prepare('SELECT mapped_username FROM user_mappings WHERE primary_username = ? AND server_type = ? LIMIT 1').get(primaryUsername, mapping.preferred_avatar_server);
    if (serverMapping) {
      const user = db.prepare('SELECT id FROM users WHERE username = ? AND server_type = ? LIMIT 1').get(serverMapping.mapped_username, mapping.preferred_avatar_server);
      return user ? user.id : null;
    }
  }

  // For non-mapped users, look up directly
  const user = db.prepare('SELECT id FROM users WHERE username = ? LIMIT 1').get(primaryUsername);
  return user ? user.id : null;
}

// Helper function to get avatar for a primary username based on user mapping preferences
// Returns an object with { thumb, server_type } or null if no avatar found
function getAvatarForPrimaryUser(primaryUsername) {
  // Check if this is a mapped user (primary username exists in user_mappings)
  const isMapped = db.prepare(`
    SELECT COUNT(*) as count FROM user_mappings WHERE primary_username = ?
  `).get(primaryUsername);

  if (isMapped && isMapped.count > 0) {
    // This is a mapped user - use preferred avatar server logic
    const preferredMapping = db.prepare(`
      SELECT preferred_avatar_server, mapped_username, server_type
      FROM user_mappings
      WHERE primary_username = ?
      LIMIT 1
    `).get(primaryUsername);

    if (preferredMapping && preferredMapping.preferred_avatar_server) {
      // Try to get the avatar from the preferred server
      const preferredAvatar = db.prepare(`
        SELECT thumb, server_type FROM users
        WHERE username = (
          SELECT mapped_username FROM user_mappings
          WHERE primary_username = ? AND server_type = ?
        )
        AND server_type = ?
        AND thumb IS NOT NULL
        LIMIT 1
      `).get(primaryUsername, preferredMapping.preferred_avatar_server, preferredMapping.preferred_avatar_server);

      if (preferredAvatar) {
        return { thumb: preferredAvatar.thumb, server_type: preferredAvatar.server_type };
      }
    }

    // Fall back to any available avatar for this primary username
    const fallbackAvatar = db.prepare(`
      SELECT u.thumb, u.server_type FROM users u
      INNER JOIN user_mappings um ON u.username = um.mapped_username AND u.server_type = um.server_type
      WHERE um.primary_username = ? AND u.thumb IS NOT NULL
      LIMIT 1
    `).get(primaryUsername);

    if (fallbackAvatar && fallbackAvatar.thumb) {
      return { thumb: fallbackAvatar.thumb, server_type: fallbackAvatar.server_type };
    }

    // No avatar found for mapped user - return server type for icon fallback
    const serverType = db.prepare(`
      SELECT server_type FROM user_mappings WHERE primary_username = ? LIMIT 1
    `).get(primaryUsername);
    return { thumb: null, server_type: serverType ? serverType.server_type : null };
  } else {
    // This is an unmapped user - check if they have an avatar in users table
    const userAvatar = db.prepare(`
      SELECT thumb, server_type FROM users
      WHERE username = ?
      AND thumb IS NOT NULL
      LIMIT 1
    `).get(primaryUsername);

    if (userAvatar && userAvatar.thumb) {
      return { thumb: userAvatar.thumb, server_type: userAvatar.server_type };
    }

    // No avatar found - get server type for icon fallback
    const serverType = db.prepare(`
      SELECT server_type FROM users WHERE username = ? LIMIT 1
    `).get(primaryUsername);
    return { thumb: null, server_type: serverType ? serverType.server_type : null };
  }
}

// Get all users grouped by server type
router.get('/settings/users-by-server', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT DISTINCT username, server_type, thumb
      FROM users
      ORDER BY server_type, username
    `).all();

    const grouped = {
      plex: [],
      emby: [],
      jellyfin: [],
      audiobookshelf: [],
      sappho: []
    };

    users.forEach(user => {
      if (grouped[user.server_type]) {
        grouped[user.server_type].push({
          username: user.username,
          thumb: user.thumb
        });
      }
    });

    res.json({ success: true, data: grouped });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all user mappings grouped by primary user
router.get('/settings/user-mappings', (req, res) => {
  try {
    const mappings = db.prepare('SELECT * FROM user_mappings ORDER BY primary_username, server_type').all();

    // Group by primary username
    const grouped = {};
    mappings.forEach(mapping => {
      if (!grouped[mapping.primary_username]) {
        grouped[mapping.primary_username] = {
          primary_username: mapping.primary_username,
          mappings: {
            plex: null,
            emby: null,
            jellyfin: null,
            audiobookshelf: null,
            sappho: null
          },
          preferred_avatar_server: mapping.preferred_avatar_server || 'plex'
        };
      }
      if (mapping.server_type) {
        grouped[mapping.primary_username].mappings[mapping.server_type] = mapping.mapped_username;
        // Update preferred_avatar_server if this mapping has it set
        if (mapping.preferred_avatar_server) {
          grouped[mapping.primary_username].preferred_avatar_server = mapping.preferred_avatar_server;
        }
      }
    });

    res.json({ success: true, data: Object.values(grouped) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create or update user mappings (bulk operation for a primary user)
router.post('/settings/user-mappings', (req, res) => {
  try {
    const { primary_username, mappings, preferred_avatar_server } = req.body;
    // mappings should be: { plex: 'username1', emby: 'username2', audiobookshelf: null }

    console.log('💾 Saving user mapping:', { primary_username, mappings, preferred_avatar_server });

    if (!primary_username) {
      return res.status(400).json({
        success: false,
        error: 'primary_username is required'
      });
    }

    const now = Math.floor(Date.now() / 1000);

    // First, check for conflicts BEFORE deleting existing mappings
    const serverTypes = ['plex', 'emby', 'jellyfin', 'audiobookshelf', 'sappho'];
    for (const serverType of serverTypes) {
      if (mappings[serverType] && mappings[serverType].trim() !== '') {
        const mapped_username = mappings[serverType].trim();

        console.log(`  Checking ${serverType}: ${mapped_username}`);

        // Check if this mapped username is already used by another primary user
        const existing = db.prepare('SELECT primary_username FROM user_mappings WHERE mapped_username = ? AND server_type = ? AND primary_username != ?')
          .get(mapped_username, serverType, primary_username);

        if (existing) {
          console.log(`  ❌ Conflict found: ${mapped_username} already mapped to ${existing.primary_username}`);
          return res.status(400).json({
            success: false,
            error: `Username "${mapped_username}" is already mapped to "${existing.primary_username}"`
          });
        }
      }
    }

    console.log('  ✅ No conflicts found, proceeding with save');

    // Delete existing mappings for this primary user
    const deleted = db.prepare('DELETE FROM user_mappings WHERE primary_username = ?').run(primary_username);
    console.log(`  Deleted ${deleted.changes} existing mappings for ${primary_username}`);

    // Insert new mappings
    for (const serverType of serverTypes) {
      if (mappings[serverType] && mappings[serverType].trim() !== '') {
        const mapped_username = mappings[serverType].trim();
        const avatarServer = preferred_avatar_server || 'plex';

        console.log(`  Inserting: ${primary_username} -> ${mapped_username} (${serverType}), avatar: ${avatarServer}`);
        db.prepare(`
          INSERT INTO user_mappings (primary_username, mapped_username, server_type, preferred_avatar_server, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(primary_username, mapped_username, serverType, avatarServer, now);
      }
    }

    console.log('  ✅ Mappings saved successfully');
    res.json({ success: true, message: 'Mappings saved successfully' });
  } catch (error) {
    console.error('  ❌ Error saving mappings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete all mappings for a primary user
router.delete('/settings/user-mappings/:primaryUsername', (req, res) => {
  try {
    const { primaryUsername } = req.params;

    db.prepare('DELETE FROM user_mappings WHERE primary_username = ?').run(primaryUsername);
    res.json({ success: true, message: 'Mappings deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug endpoint to see all raw mappings
router.get('/settings/user-mappings/debug/raw', (req, res) => {
  try {
    const mappings = db.prepare('SELECT * FROM user_mappings ORDER BY id').all();
    res.json({ success: true, data: mappings });
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

// Purge user data from database (keeps settings and server config)
router.post('/database/purge', async (req, res) => {
  try {
    const path = await import('path');
    const fs = await import('fs');
    const Database = (await import('better-sqlite3')).default;
    const dbPath = process.env.DATABASE_PATH || './data/opsdec.db';
    const backupPath = path.join(path.dirname(dbPath), `opsdec_backup_${Date.now()}.db`);

    // Count rows before backup to verify data exists
    const tablesToPurge = ['history', 'sessions', 'users', 'user_mappings', 'library_stats', 'ip_cache'];
    const rowCounts = {};
    let totalRows = 0;

    for (const table of tablesToPurge) {
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get().count;
      rowCounts[table] = count;
      totalRows += count;
    }

    console.log(`Database contains ${totalRows} total rows to be purged:`, rowCounts);

    console.log(`Creating database backup at ${backupPath}`);

    // Use better-sqlite3's safe backup method
    await db.backup(backupPath);

    // Verify backup was created and has reasonable size
    const backupStats = await fs.promises.stat(backupPath);
    const originalStats = await fs.promises.stat(dbPath);

    if (backupStats.size === 0) {
      throw new Error('Backup file is empty');
    }

    // Backup should be at least 50% of original size (accounting for possible VACUUM)
    if (backupStats.size < originalStats.size * 0.5) {
      console.warn(`Warning: Backup size (${backupStats.size}) is significantly smaller than original (${originalStats.size})`);
    }

    // Verify backup by opening it and checking row counts
    console.log('Verifying backup integrity...');
    const backupDb = new Database(backupPath, { readonly: true });

    let backupInfo = {
      servers: 0,
      settings: 0,
      users: 0,
      history: 0
    };

    try {
      // Verify data that will be purged
      for (const table of tablesToPurge) {
        const backupCount = backupDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get().count;
        if (backupCount !== rowCounts[table]) {
          throw new Error(`Backup verification failed: ${table} has ${backupCount} rows, expected ${rowCounts[table]}`);
        }
      }

      // Verify critical data that should be preserved
      backupInfo.servers = backupDb.prepare('SELECT COUNT(*) as count FROM servers').get().count;
      backupInfo.settings = backupDb.prepare('SELECT COUNT(*) as count FROM settings').get().count;
      backupInfo.users = backupDb.prepare('SELECT COUNT(*) as count FROM users').get().count;
      backupInfo.history = backupDb.prepare('SELECT COUNT(*) as count FROM history').get().count;

      console.log('Backup verification successful:', backupInfo);

      // Double-check that servers and settings were backed up
      if (backupInfo.servers === 0) {
        throw new Error('CRITICAL: Backup has no server configurations! Aborting purge.');
      }
      if (backupInfo.settings === 0) {
        throw new Error('CRITICAL: Backup has no settings! Aborting purge.');
      }

    } finally {
      backupDb.close();
    }

    console.log('Backup created and verified successfully, purging user data...');

    // Delete user data while preserving settings and servers in a transaction
    const purge = db.transaction(() => {
      for (const table of tablesToPurge) {
        db.prepare(`DELETE FROM ${table}`).run();
        console.log(`Deleted ${rowCounts[table]} rows from ${table}`);
      }
    });

    purge();

    // Run VACUUM separately after the transaction
    db.prepare('VACUUM').run();

    console.log('Database purge completed successfully');

    res.json({
      success: true,
      message: 'User data purged successfully',
      backupPath: backupPath,
      rowsPurged: totalRows,
      backupVerified: true,
      backupInfo: backupInfo
    });
  } catch (error) {
    console.error('Database purge error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create a manual backup of the database
router.post('/database/backup', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const dbPath = process.env.DATABASE_PATH || './data/opsdec.db';
    const backupPath = path.join(path.dirname(dbPath), `opsdec_backup_${Date.now()}.db`);

    console.log(`Creating database backup at ${backupPath}`);

    // Use better-sqlite3's safe backup method
    await db.backup(backupPath);

    // Get backup file stats
    const stats = await fs.promises.stat(backupPath);

    console.log('Backup created successfully');

    res.json({
      success: true,
      message: 'Database backup created successfully',
      backup: {
        filename: path.basename(backupPath),
        path: backupPath,
        size: stats.size,
        created: stats.mtime
      }
    });
  } catch (error) {
    console.error('Database backup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload a backup file
router.post('/database/backups/upload', upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const fs = await import('fs');
    const path = await import('path');

    // Validate that the uploaded file is a valid SQLite database
    const Database = (await import('better-sqlite3')).default;
    let uploadedDb;
    try {
      uploadedDb = new Database(req.file.path, { readonly: true });

      // Check for required tables
      const tables = uploadedDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const tableNames = tables.map(t => t.name);
      const requiredTables = ['servers', 'settings'];

      for (const table of requiredTables) {
        if (!tableNames.includes(table)) {
          uploadedDb.close();
          await fs.promises.unlink(req.file.path);
          return res.status(400).json({
            success: false,
            error: `Invalid backup: missing required table '${table}'`
          });
        }
      }

      uploadedDb.close();
    } catch (error) {
      if (uploadedDb) uploadedDb.close();
      await fs.promises.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        error: `Invalid database file: ${error.message}`
      });
    }

    // Get file stats
    const stats = await fs.promises.stat(req.file.path);

    console.log(`Backup uploaded successfully: ${req.file.filename}`);

    res.json({
      success: true,
      message: 'Backup uploaded successfully',
      backup: {
        filename: req.file.filename,
        path: req.file.path,
        size: stats.size,
        created: stats.mtime
      }
    });
  } catch (error) {
    console.error('Backup upload error:', error);
    if (req.file) {
      const fs = await import('fs');
      await fs.promises.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get list of available backups
router.get('/database/backups', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const dbPath = process.env.DATABASE_PATH || './data/opsdec.db';
    const dataDir = path.dirname(dbPath);

    // Read directory and filter for backup files
    const files = await fs.promises.readdir(dataDir);
    const backupFiles = files.filter(f => f.startsWith('opsdec_backup_') && f.endsWith('.db'));

    // Get stats for each backup
    const backups = await Promise.all(
      backupFiles.map(async (filename) => {
        const filePath = path.join(dataDir, filename);
        const stats = await fs.promises.stat(filePath);
        return {
          filename,
          path: filePath,
          size: stats.size,
          created: stats.mtime
        };
      })
    );

    // Sort by creation date, newest first
    backups.sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json({
      success: true,
      backups
    });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Restore database from a backup
router.post('/database/restore', async (req, res) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({ success: false, error: 'Filename is required' });
    }

    const fs = await import('fs');
    const path = await import('path');
    const dbPath = process.env.DATABASE_PATH || './data/opsdec.db';
    const dataDir = path.resolve(path.dirname(dbPath));
    const backupPath = path.resolve(path.join(path.dirname(dbPath), filename));

    // Validate that the backup file exists and is in the data directory
    const validPrefixes = ['opsdec_backup_', 'opsdec_pre_restore_'];
    const hasValidPrefix = validPrefixes.some(prefix => filename.startsWith(prefix));

    if (!backupPath.startsWith(dataDir) || !hasValidPrefix) {
      return res.status(400).json({ success: false, error: 'Invalid backup filename' });
    }

    try {
      await fs.promises.access(backupPath);
    } catch {
      return res.status(404).json({ success: false, error: 'Backup file not found' });
    }

    // Validate backup file before restoring
    const Database = (await import('better-sqlite3')).default;
    console.log('Validating backup file...');

    let backupDb;
    try {
      backupDb = new Database(backupPath, { readonly: true });

      // Check that backup has required tables
      const tables = backupDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const tableNames = tables.map(t => t.name);
      const requiredTables = ['servers', 'settings', 'users', 'history'];

      for (const table of requiredTables) {
        if (!tableNames.includes(table)) {
          backupDb.close();
          return res.status(400).json({
            success: false,
            error: `Invalid backup: missing required table '${table}'`
          });
        }
      }

      // Check server configuration exists and get detailed counts
      const backupContents = {
        servers: backupDb.prepare('SELECT COUNT(*) as count FROM servers').get().count,
        settings: backupDb.prepare('SELECT COUNT(*) as count FROM settings').get().count,
        users: backupDb.prepare('SELECT COUNT(*) as count FROM users').get().count,
        history: backupDb.prepare('SELECT COUNT(*) as count FROM history').get().count,
        sessions: backupDb.prepare('SELECT COUNT(*) as count FROM sessions').get().count
      };

      console.log('Backup contents:', backupContents);

      if (backupContents.servers === 0) {
        backupDb.close();
        return res.status(400).json({
          success: false,
          error: 'Backup appears to be empty (no server configuration found). This may be a backup created during purge. Please select a different backup.',
          backupContents: backupContents
        });
      }

      console.log(`Backup validation successful (${backupContents.servers} servers, ${backupContents.users} users, ${backupContents.history} history records)`);
      backupDb.close();
    } catch (error) {
      if (backupDb) backupDb.close();
      return res.status(400).json({
        success: false,
        error: `Invalid backup file: ${error.message}`
      });
    }

    // Create a safety backup of current database before restoring
    const safetyBackupPath = path.join(dataDir, `opsdec_pre_restore_${Date.now()}.db`);

    console.log(`Creating safety backup at ${safetyBackupPath}`);
    await global.db.backup(safetyBackupPath);

    console.log(`Restoring database from ${backupPath}`);

    // Close the current database connection
    global.db.close();

    // Copy backup over current database
    await fs.promises.copyFile(backupPath, dbPath);

    // Reinitialize the database connection
    const BetterSqlite3 = (await import('better-sqlite3')).default;
    global.db = new BetterSqlite3(dbPath);

    // Ensure WAL mode is enabled on the restored database
    global.db.pragma('journal_mode = WAL');

    console.log('Database restored successfully');

    res.json({
      success: true,
      message: 'Database restored successfully',
      safetyBackup: safetyBackupPath,
      restored: backupContents
    });
  } catch (error) {
    console.error('Database restore error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download a backup file
router.get('/database/backups/:filename/download', async (req, res) => {
  try {
    const { filename } = req.params;

    const fs = await import('fs');
    const path = await import('path');
    const dbPath = process.env.DATABASE_PATH || './data/opsdec.db';
    const dataDir = path.resolve(path.dirname(dbPath));
    const backupPath = path.resolve(path.join(path.dirname(dbPath), filename));

    // Validate that the backup file is in the data directory and has correct naming
    const validPrefixes = ['opsdec_backup_', 'opsdec_pre_restore_'];
    const hasValidPrefix = validPrefixes.some(prefix => filename.startsWith(prefix));

    if (!backupPath.startsWith(dataDir) || !hasValidPrefix) {
      return res.status(400).json({ success: false, error: 'Invalid backup filename' });
    }

    // Check if file exists
    try {
      await fs.promises.access(backupPath);
    } catch {
      return res.status(404).json({ success: false, error: 'Backup file not found' });
    }

    console.log(`Downloading backup: ${filename}`);

    // Set headers for file download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream the file to the response
    const fileStream = (await import('fs')).default.createReadStream(backupPath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Download backup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a backup file
router.delete('/database/backups/:filename', async (req, res) => {
  try {
    const { filename } = req.params;

    const fs = await import('fs');
    const path = await import('path');
    const dbPath = process.env.DATABASE_PATH || './data/opsdec.db';
    const dataDir = path.resolve(path.dirname(dbPath));
    const backupPath = path.resolve(path.join(path.dirname(dbPath), filename));

    // Validate that the backup file is in the data directory and has correct naming
    const validPrefixes = ['opsdec_backup_', 'opsdec_pre_restore_'];
    const hasValidPrefix = validPrefixes.some(prefix => filename.startsWith(prefix));

    if (!backupPath.startsWith(dataDir) || !hasValidPrefix) {
      return res.status(400).json({ success: false, error: 'Invalid backup filename' });
    }

    // Check if file exists
    try {
      await fs.promises.access(backupPath);
    } catch {
      return res.status(404).json({ success: false, error: 'Backup file not found' });
    }

    // Delete the backup file
    await fs.promises.unlink(backupPath);

    console.log(`Deleted backup: ${filename}`);

    res.json({
      success: true,
      message: 'Backup deleted successfully'
    });
  } catch (error) {
    console.error('Delete backup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
