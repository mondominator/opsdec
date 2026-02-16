import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import db from '../database/init.js';

const CACHE_DIR = process.env.IMAGE_CACHE_DIR || join(process.cwd(), 'data', 'cache', 'covers');
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

class ImageCacheService {
  constructor() {
    this.cacheDir = CACHE_DIR;
    this.ensureCacheDir();
  }

  ensureCacheDir() {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  hashUrl(url) {
    return createHash('sha256').update(url).digest('hex');
  }

  extensionFromContentType(contentType) {
    const map = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
      'image/avif': '.avif',
    };
    return map[contentType] || '.bin';
  }

  get(url) {
    const hash = this.hashUrl(url);
    try {
      const row = db.prepare('SELECT * FROM image_cache WHERE url_hash = ?').get(hash);
      if (!row) return null;

      const filePath = join(this.cacheDir, row.file_path);
      if (!existsSync(filePath)) {
        // File missing from disk — clean up stale DB entry
        db.prepare('DELETE FROM image_cache WHERE url_hash = ?').run(hash);
        return null;
      }

      const data = readFileSync(filePath);

      // Update last_accessed_at
      db.prepare('UPDATE image_cache SET last_accessed_at = ? WHERE url_hash = ?')
        .run(Math.floor(Date.now() / 1000), hash);

      return { data, contentType: row.content_type };
    } catch {
      return null;
    }
  }

  put(url, data, contentType) {
    const hash = this.hashUrl(url);
    const ext = this.extensionFromContentType(contentType);
    const fileName = `${hash}${ext}`;
    const filePath = join(this.cacheDir, fileName);

    try {
      this.ensureCacheDir();
      writeFileSync(filePath, data);

      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT OR REPLACE INTO image_cache (url_hash, original_url, file_path, content_type, file_size, created_at, last_accessed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(hash, url, fileName, contentType, data.length, now, now);
    } catch (error) {
      console.error('Error caching image:', error.message);
    }
  }

  evict() {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - MAX_AGE_SECONDS;
    let removedAge = 0;
    let removedLru = 0;

    // 1. Remove entries older than max age
    const expired = db.prepare('SELECT url_hash, file_path FROM image_cache WHERE last_accessed_at < ?').all(cutoff);
    for (const row of expired) {
      this.deleteEntry(row);
      removedAge++;
    }

    // 2. If still over max size, remove LRU entries
    const totalSize = this.getTotalSize();
    if (totalSize > MAX_SIZE_BYTES) {
      const entries = db.prepare('SELECT url_hash, file_path, file_size FROM image_cache ORDER BY last_accessed_at ASC').all();
      let currentSize = totalSize;
      for (const row of entries) {
        if (currentSize <= MAX_SIZE_BYTES) break;
        this.deleteEntry(row);
        currentSize -= row.file_size;
        removedLru++;
      }
    }

    return { removedAge, removedLru };
  }

  deleteEntry(row) {
    try {
      const filePath = join(this.cacheDir, row.file_path);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // File already gone
    }
    db.prepare('DELETE FROM image_cache WHERE url_hash = ?').run(row.url_hash);
  }

  getTotalSize() {
    const result = db.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM image_cache').get();
    return result.total;
  }

  getStats() {
    const count = db.prepare('SELECT COUNT(*) as count FROM image_cache').get().count;
    const totalSize = this.getTotalSize();
    return { entries: count, totalSizeBytes: totalSize };
  }

  clearAll() {
    const entries = db.prepare('SELECT file_path FROM image_cache').all();
    for (const row of entries) {
      try {
        const filePath = join(this.cacheDir, row.file_path);
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
      } catch {
        // ignore
      }
    }
    db.prepare('DELETE FROM image_cache').run();

    // Also remove any orphaned files in the cache dir
    try {
      if (existsSync(this.cacheDir)) {
        const files = readdirSync(this.cacheDir);
        for (const file of files) {
          try {
            unlinkSync(join(this.cacheDir, file));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

export default new ImageCacheService();
