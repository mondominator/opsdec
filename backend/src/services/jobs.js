import cron from 'node-cron';
import { db } from '../database/init.js';
import imageCache from './imageCache.js';
import telegram from './telegram.js';

// Job definitions
const jobDefinitions = {
  'check-recently-added': {
    name: 'Check Recently Added',
    description: 'Poll media servers for new content and send Telegram notifications',
    cronSchedule: '*/5 * * * *', // Every 5 minutes
    handler: null // Will be set when at least one service is available
  },
  'repair-covers': {
    name: 'Repair Covers',
    description: 'Fix stale cover URLs for moved/reimported items across all media servers',
    cronSchedule: '*/30 * * * *', // Every 30 minutes
    handler: null // Will be set when at least one service is available
  },
  'merge-duplicates': {
    name: 'Merge Duplicates',
    description: 'Consolidate duplicate history entries with same media_id + user_id',
    cronSchedule: '*/15 * * * *', // Every 15 minutes
    handler: mergeDuplicatesJob
  },
  'evict-image-cache': {
    name: 'Evict Image Cache',
    description: 'Remove expired and excess cached cover images from disk',
    cronSchedule: '0 */6 * * *', // Every 6 hours
    handler: evictImageCacheJob
  }
};

// Track running jobs to prevent overlapping runs
const runningJobs = new Set();

// Cron job instances
const cronJobs = {};

// Service references for jobs that need them
let audiobookshelfServiceRef = null;
let plexServiceRef = null;
let embyServiceRef = null;
let jellyfinServiceRef = null;
let sapphoServiceRef = null;

export function setAudiobookshelfService(service) {
  audiobookshelfServiceRef = service;
  updateServiceDependentHandlers();
}

export function setPlexService(service) {
  plexServiceRef = service;
  updateServiceDependentHandlers();
}

export function setEmbyService(service) {
  embyServiceRef = service;
  updateServiceDependentHandlers();
}

export function setJellyfinService(service) {
  jellyfinServiceRef = service;
  updateServiceDependentHandlers();
}

export function setSapphoService(service) {
  sapphoServiceRef = service;
  updateServiceDependentHandlers();
}

function updateServiceDependentHandlers() {
  // Enable repair-covers job if at least one service is configured
  if (audiobookshelfServiceRef || plexServiceRef || embyServiceRef || jellyfinServiceRef) {
    jobDefinitions['repair-covers'].handler = repairCoversJob;
  }
  // Enable check-recently-added job if at least one service is configured
  if (audiobookshelfServiceRef || plexServiceRef || embyServiceRef || jellyfinServiceRef || sapphoServiceRef) {
    jobDefinitions['check-recently-added'].handler = checkRecentlyAddedJob;

    // Register metadata refresher so telegram can re-fetch posters/thumbs at send time
    telegram.setMetadataRefresher(async (items) => {
      const serviceMap = { plex: plexServiceRef, emby: embyServiceRef, jellyfin: jellyfinServiceRef, audiobookshelf: audiobookshelfServiceRef, sappho: sapphoServiceRef };
      const serverTypes = [...new Set(items.map(i => i.server_type))];
      const freshByKey = new Map();
      await Promise.all(serverTypes.map(async (type) => {
        const svc = serviceMap[type];
        if (!svc) return;
        try {
          const fresh = await svc.getRecentlyAdded(50);
          for (const item of fresh) {
            freshByKey.set(`${type}|${item.id}`, item);
          }
        } catch {
          // If a server is unreachable, keep original data for its items
        }
      }));
      return items.map(item => {
        const fresh = freshByKey.get(`${item.server_type}|${item.id}`);
        if (fresh) return { ...item, thumb: fresh.thumb || item.thumb, name: fresh.name || item.name };
        return item;
      });
    });
  }
}

// Initialize jobs - create entries in database and start cron schedules
export function initializeJobs() {
  console.log('🔧 Initializing scheduled maintenance jobs...');

  for (const [jobId, jobDef] of Object.entries(jobDefinitions)) {
    // Ensure job exists in database
    const existing = db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(jobId);
    if (!existing) {
      db.prepare(`
        INSERT INTO scheduled_jobs (id, name, description, cron_schedule, enabled)
        VALUES (?, ?, ?, ?, 1)
      `).run(jobId, jobDef.name, jobDef.description, jobDef.cronSchedule);
      console.log(`   Created job: ${jobDef.name}`);
    } else {
      // Update description if it changed
      if (existing.description !== jobDef.description) {
        db.prepare('UPDATE scheduled_jobs SET description = ? WHERE id = ?').run(jobDef.description, jobId);
        console.log(`   Updated job description: ${jobDef.name}`);
      }
    }

    // Get job settings from database (user may have changed schedule/enabled)
    const jobSettings = db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(jobId);

    if (jobSettings.enabled && jobDef.handler) {
      // Start cron job
      const schedule = jobSettings.cron_schedule || jobDef.cronSchedule;
      cronJobs[jobId] = cron.schedule(schedule, () => {
        runJob(jobId);
      });
      console.log(`   Scheduled: ${jobDef.name} (${schedule})`);
    }
  }
}

// Run a specific job
export async function runJob(jobId, manual = false) {
  const jobDef = jobDefinitions[jobId];
  if (!jobDef) {
    throw new Error(`Unknown job: ${jobId}`);
  }

  if (!jobDef.handler) {
    throw new Error(`Job ${jobId} has no handler (service not configured)`);
  }

  // Prevent overlapping runs
  if (runningJobs.has(jobId)) {
    console.log(`⏭️ Job ${jobDef.name} already running, skipping`);
    return { skipped: true, reason: 'already running' };
  }

  runningJobs.add(jobId);
  const startTime = Date.now();
  const runType = manual ? 'manual' : 'scheduled';

  console.log(`🔧 Running job: ${jobDef.name} (${runType})`);

  try {
    const result = await jobDef.handler();

    const duration = Date.now() - startTime;

    // Update job record
    db.prepare(`
      UPDATE scheduled_jobs
      SET last_run = ?, last_status = 'success', last_result = ?, last_duration = ?
      WHERE id = ?
    `).run(Math.floor(Date.now() / 1000), JSON.stringify(result), duration, jobId);

    console.log(`✅ Job ${jobDef.name} completed in ${duration}ms`);

    return { success: true, result, duration };
  } catch (error) {
    const duration = Date.now() - startTime;

    // Update job record with error
    db.prepare(`
      UPDATE scheduled_jobs
      SET last_run = ?, last_status = 'error', last_result = ?, last_duration = ?
      WHERE id = ?
    `).run(Math.floor(Date.now() / 1000), JSON.stringify({ error: error.message }), duration, jobId);

    console.error(`❌ Job ${jobDef.name} failed:`, error.message);

    return { success: false, error: error.message, duration };
  } finally {
    runningJobs.delete(jobId);
  }
}

// Get all jobs with their status
export function getJobs() {
  const jobs = db.prepare('SELECT * FROM scheduled_jobs ORDER BY name').all();

  return jobs.map(job => {
    const def = jobDefinitions[job.id];
    return {
      ...job,
      isRunning: runningJobs.has(job.id),
      hasHandler: def?.handler != null,
      nextRun: job.enabled ? getNextCronRun(job.cron_schedule) : null,
      lastResult: job.last_result ? JSON.parse(job.last_result) : null
    };
  });
}

// Update job settings
export function updateJob(jobId, settings) {
  const { enabled, cronSchedule } = settings;

  const updates = [];
  const values = [];

  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (cronSchedule !== undefined) {
    // Validate cron expression
    if (!cron.validate(cronSchedule)) {
      throw new Error('Invalid cron schedule');
    }
    updates.push('cron_schedule = ?');
    values.push(cronSchedule);
  }

  if (updates.length > 0) {
    values.push(jobId);
    db.prepare(`UPDATE scheduled_jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // Restart cron job with new settings
    restartCronJob(jobId);
  }

  return getJobs().find(j => j.id === jobId);
}

// Restart a cron job (after settings change)
function restartCronJob(jobId) {
  // Stop existing cron job
  if (cronJobs[jobId]) {
    cronJobs[jobId].stop();
    delete cronJobs[jobId];
  }

  const jobDef = jobDefinitions[jobId];
  const jobSettings = db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(jobId);

  if (jobSettings.enabled && jobDef?.handler) {
    const schedule = jobSettings.cron_schedule;
    cronJobs[jobId] = cron.schedule(schedule, () => {
      runJob(jobId);
    });
    console.log(`🔄 Restarted job: ${jobDef.name} (${schedule})`);
  }
}

// Calculate next cron run time
function getNextCronRun(cronSchedule) {
  try {
    // Parse cron expression to get next run
    // This is a simple approximation - for exact timing would need a cron parser
    const parts = cronSchedule.split(' ');
    if (parts[0].startsWith('*/')) {
      const interval = parseInt(parts[0].slice(2));
      const now = new Date();
      const minutes = now.getMinutes();
      const nextMinutes = Math.ceil((minutes + 1) / interval) * interval;
      const nextRun = new Date(now);
      nextRun.setMinutes(nextMinutes % 60);
      nextRun.setSeconds(0);
      nextRun.setMilliseconds(0);
      if (nextMinutes >= 60) {
        nextRun.setHours(nextRun.getHours() + 1);
      }
      return Math.floor(nextRun.getTime() / 1000);
    }
    return null;
  } catch {
    return null;
  }
}

// Job handlers

async function checkRecentlyAddedJob() {
  const limit = 30;

  // Check preferred server settings
  const videoRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('recently_added_video_server');
  const bookRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('recently_added_book_server');
  const preferredVideo = videoRow?.value || '';
  const preferredBook = bookRow?.value || '';

  const serviceMap = {
    plex: plexServiceRef,
    emby: embyServiceRef,
    jellyfin: jellyfinServiceRef,
    audiobookshelf: audiobookshelfServiceRef,
    sappho: sapphoServiceRef
  };

  const serversToQuery = new Set();
  const videoServers = ['plex', 'emby', 'jellyfin'];
  const bookServers = ['audiobookshelf', 'sappho'];

  if (preferredVideo && serviceMap[preferredVideo]) {
    serversToQuery.add(preferredVideo);
  } else {
    videoServers.forEach(s => serversToQuery.add(s));
  }

  if (preferredBook && serviceMap[preferredBook]) {
    serversToQuery.add(preferredBook);
  } else {
    bookServers.forEach(s => serversToQuery.add(s));
  }

  const promises = [];
  for (const type of serversToQuery) {
    const svc = serviceMap[type];
    if (svc) promises.push(svc.getRecentlyAdded(limit).then(items => items.map(i => ({ ...i, server_type: type }))));
  }

  const results = await Promise.all(promises);
  const allItems = results.flat();

  // Only items from last 14 days
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const recentItems = allItems
    .filter(i => i.addedAt && new Date(i.addedAt) >= cutoff)
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
    .slice(0, limit);

  // Check for new items
  const notifiedCount = db.prepare('SELECT COUNT(*) AS cnt FROM notified_recently_added').get().cnt;
  const notified = new Set(
    db.prepare('SELECT server_type || \'|\' || media_id AS key FROM notified_recently_added').all().map(r => r.key)
  );
  const newItems = recentItems.filter(i => !notified.has(i.server_type + '|' + i.id));

  if (newItems.length > 0) {
    if (notifiedCount > 0) {
      telegram.notifyRecentlyAdded(newItems);
    }
    const insert = db.prepare('INSERT OR IGNORE INTO notified_recently_added (server_type, media_id, title) VALUES (?, ?, ?)');
    for (const item of newItems) {
      insert.run(item.server_type, item.id, item.name);
    }
  }

  return { checked: recentItems.length, newItems: newItems.length, notified: notifiedCount > 0 && newItems.length > 0 };
}

// Check if item title from server matches what's in history
function titleMatchesHistory(itemInfo, entry) {
  const serverTitle = (itemInfo.title || '').toLowerCase();
  const serverSeries = (itemInfo.grandparentTitle || '').toLowerCase();
  const historyTitle = (entry.title || '').toLowerCase();
  const historySeries = (entry.grandparent_title || '').toLowerCase();

  // For episodes: series name should match
  if (serverSeries && historySeries) {
    return serverSeries === historySeries;
  }
  // For movies/audiobooks: title should match
  return serverTitle === historyTitle;
}

async function repairCoversJob() {
  const results = {
    audiobookshelf: { repaired: 0, coverUpdated: 0, notFound: 0, alreadyValid: 0, total: 0 },
    plex: { coverUpdated: 0, notFound: 0, alreadyValid: 0, total: 0 },
    emby: { coverUpdated: 0, notFound: 0, alreadyValid: 0, total: 0 },
    jellyfin: { coverUpdated: 0, notFound: 0, alreadyValid: 0, total: 0 }
  };

  // Log which services are available
  console.log('   Services available:', {
    audiobookshelf: !!audiobookshelfServiceRef,
    plex: !!plexServiceRef,
    emby: !!embyServiceRef,
    jellyfin: !!jellyfinServiceRef
  });

  // Process Audiobookshelf entries (with search by title fallback)
  if (audiobookshelfServiceRef) {
    console.log('   Processing Audiobookshelf history...');
    const absHistory = db.prepare(`
      SELECT id, title, grandparent_title, media_id, thumb
      FROM history
      WHERE server_type = 'audiobookshelf'
    `).all();

    results.audiobookshelf.total = absHistory.length;

    for (const entry of absHistory) {
      const itemInfo = await audiobookshelfServiceRef.getItemInfo(entry.media_id);

      if (itemInfo.exists && titleMatchesHistory(itemInfo, entry)) {
        if (itemInfo.coverUrl && itemInfo.coverUrl !== entry.thumb) {
          db.prepare(`UPDATE history SET thumb = ? WHERE id = ?`).run(itemInfo.coverUrl, entry.id);
          results.audiobookshelf.coverUpdated++;
        } else {
          results.audiobookshelf.alreadyValid++;
        }
        continue;
      }

      // Item doesn't exist or title mismatch - search by title
      if (itemInfo.exists) {
        console.log(`   Title mismatch for media_id ${entry.media_id}: expected "${entry.title}", server has "${itemInfo.title}"`);
      }
      const found = await audiobookshelfServiceRef.searchByTitle(entry.title);
      if (found) {
        db.prepare(`UPDATE history SET media_id = ?, thumb = ? WHERE id = ?`).run(found.id, found.coverUrl, entry.id);
        results.audiobookshelf.repaired++;
      } else {
        results.audiobookshelf.notFound++;
      }
    }
  }

  // Process Plex entries
  if (plexServiceRef) {
    console.log('   Processing Plex history...');
    const plexHistory = db.prepare(`
      SELECT id, title, grandparent_title, media_id, thumb
      FROM history
      WHERE server_type = 'plex'
    `).all();
    console.log(`   Found ${plexHistory.length} Plex history entries`);
    const plexMissingThumbs = plexHistory.filter(e => !e.thumb).length;
    console.log(`   ${plexMissingThumbs} entries have no thumb URL`);

    results.plex.total = plexHistory.length;

    for (const entry of plexHistory) {
      const itemInfo = await plexServiceRef.getItemInfo(entry.media_id);

      if (itemInfo.exists && titleMatchesHistory(itemInfo, entry)) {
        // Update if: no thumb, or URL changed, or server has a cover when we don't
        if (itemInfo.coverUrl && (!entry.thumb || itemInfo.coverUrl !== entry.thumb)) {
          db.prepare(`UPDATE history SET thumb = ? WHERE id = ?`).run(itemInfo.coverUrl, entry.id);
          results.plex.coverUpdated++;
          console.log(`   Updated cover for: ${entry.title}`);
        } else if (!itemInfo.coverUrl && !entry.thumb) {
          results.plex.alreadyValid++; // Both have no cover
        } else {
          results.plex.alreadyValid++;
        }
      } else {
        // Item not found by ID or title mismatch (ID reused by different media) - try searching by title
        if (itemInfo.exists) {
          console.log(`   Title mismatch for media_id ${entry.media_id}: expected "${entry.grandparent_title || entry.title}", server has "${itemInfo.grandparentTitle || itemInfo.title}"`);
        }
        const found = await plexServiceRef.searchByTitle(entry.title);
        if (found) {
          db.prepare(`UPDATE history SET media_id = ?, thumb = ? WHERE id = ?`).run(found.id, found.coverUrl, entry.id);
          results.plex.coverUpdated++;
          console.log(`   Repaired by title search: ${entry.title}`);
        } else {
          results.plex.notFound++;
        }
      }
    }
  }

  // Process Emby entries
  if (embyServiceRef) {
    console.log('   Processing Emby history...');
    const embyHistory = db.prepare(`
      SELECT id, title, grandparent_title, media_id, thumb
      FROM history
      WHERE server_type = 'emby'
    `).all();
    console.log(`   Found ${embyHistory.length} Emby history entries`);
    const embyMissingThumbs = embyHistory.filter(e => !e.thumb).length;
    console.log(`   ${embyMissingThumbs} entries have no thumb URL`);

    results.emby.total = embyHistory.length;

    for (const entry of embyHistory) {
      const itemInfo = await embyServiceRef.getItemInfo(entry.media_id);

      if (itemInfo.exists && titleMatchesHistory(itemInfo, entry)) {
        // Update if: no thumb, or URL changed, or server has a cover when we don't
        if (itemInfo.coverUrl && (!entry.thumb || itemInfo.coverUrl !== entry.thumb)) {
          db.prepare(`UPDATE history SET thumb = ? WHERE id = ?`).run(itemInfo.coverUrl, entry.id);
          results.emby.coverUpdated++;
          console.log(`   Updated cover for: ${entry.title}`);
        } else if (!itemInfo.coverUrl && !entry.thumb) {
          results.emby.alreadyValid++; // Both have no cover
        } else {
          results.emby.alreadyValid++;
        }
      } else {
        // Item not found by ID or title mismatch (ID reused by different media) - try searching by title
        if (itemInfo.exists) {
          console.log(`   Title mismatch for media_id ${entry.media_id}: expected "${entry.grandparent_title || entry.title}", server has "${itemInfo.grandparentTitle || itemInfo.title}"`);
        }
        const found = await embyServiceRef.searchByTitle(entry.title);
        if (found) {
          db.prepare(`UPDATE history SET media_id = ?, thumb = ? WHERE id = ?`).run(found.id, found.coverUrl, entry.id);
          results.emby.coverUpdated++;
          console.log(`   Repaired by title search: ${entry.title}`);
        } else {
          results.emby.notFound++;
        }
      }
    }
  }

  // Process Jellyfin entries
  if (jellyfinServiceRef) {
    console.log('   Processing Jellyfin history...');
    const jellyfinHistory = db.prepare(`
      SELECT id, title, grandparent_title, media_id, thumb
      FROM history
      WHERE server_type = 'jellyfin'
    `).all();
    console.log(`   Found ${jellyfinHistory.length} Jellyfin history entries`);
    const jellyfinMissingThumbs = jellyfinHistory.filter(e => !e.thumb).length;
    console.log(`   ${jellyfinMissingThumbs} entries have no thumb URL`);

    results.jellyfin.total = jellyfinHistory.length;

    for (const entry of jellyfinHistory) {
      const itemInfo = await jellyfinServiceRef.getItemInfo(entry.media_id);

      if (itemInfo.exists && titleMatchesHistory(itemInfo, entry)) {
        // Update if: no thumb, or URL changed, or server has a cover when we don't
        if (itemInfo.coverUrl && (!entry.thumb || itemInfo.coverUrl !== entry.thumb)) {
          db.prepare(`UPDATE history SET thumb = ? WHERE id = ?`).run(itemInfo.coverUrl, entry.id);
          results.jellyfin.coverUpdated++;
          console.log(`   Updated cover for: ${entry.title}`);
        } else if (!itemInfo.coverUrl && !entry.thumb) {
          results.jellyfin.alreadyValid++; // Both have no cover
        } else {
          results.jellyfin.alreadyValid++;
        }
      } else {
        // Item not found by ID or title mismatch (ID reused by different media) - try searching by title
        if (itemInfo.exists) {
          console.log(`   Title mismatch for media_id ${entry.media_id}: expected "${entry.grandparent_title || entry.title}", server has "${itemInfo.grandparentTitle || itemInfo.title}"`);
        }
        const found = await jellyfinServiceRef.searchByTitle(entry.title);
        if (found) {
          db.prepare(`UPDATE history SET media_id = ?, thumb = ? WHERE id = ?`).run(found.id, found.coverUrl, entry.id);
          results.jellyfin.coverUpdated++;
          console.log(`   Repaired by title search: ${entry.title}`);
        } else {
          results.jellyfin.notFound++;
        }
      }
    }
  }

  // Calculate totals
  const totalProcessed = results.audiobookshelf.total + results.plex.total + results.emby.total + results.jellyfin.total;
  const totalCoverUpdated = results.audiobookshelf.coverUpdated + results.plex.coverUpdated + results.emby.coverUpdated + results.jellyfin.coverUpdated;
  const totalNotFound = results.audiobookshelf.notFound + results.plex.notFound + results.emby.notFound + results.jellyfin.notFound;

  return {
    total: totalProcessed,
    coverUpdated: totalCoverUpdated,
    notFound: totalNotFound,
    repaired: results.audiobookshelf.repaired, // Only audiobookshelf supports title search
    byServer: results
  };
}

function mergeDuplicatesJob() {
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
  }

  return { merged, duplicateSets: duplicates.length };
}

function evictImageCacheJob() {
  return imageCache.evict();
}
