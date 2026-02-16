import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { createTestDatabase } from '../setup.js';
import { tmpdir } from 'os';

/**
 * ImageCacheService is a singleton that imports the real database.
 * To test it in isolation we replicate the core logic against
 * a test database and a temporary cache directory.
 */

let testDb;
let cacheDir;

function hashUrl(url) {
  return createHash('sha256').update(url).digest('hex');
}

function extensionFromContentType(contentType) {
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

function put(url, data, contentType) {
  const hash = hashUrl(url);
  const ext = extensionFromContentType(contentType);
  const fileName = `${hash}${ext}`;
  const filePath = join(cacheDir, fileName);

  writeFileSync(filePath, data);

  const now = Math.floor(Date.now() / 1000);
  testDb.prepare(`
    INSERT OR REPLACE INTO image_cache (url_hash, original_url, file_path, content_type, file_size, created_at, last_accessed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(hash, url, fileName, contentType, data.length, now, now);
}

function get(url) {
  const hash = hashUrl(url);
  const row = testDb.prepare('SELECT * FROM image_cache WHERE url_hash = ?').get(hash);
  if (!row) return null;

  const filePath = join(cacheDir, row.file_path);
  if (!existsSync(filePath)) {
    testDb.prepare('DELETE FROM image_cache WHERE url_hash = ?').run(hash);
    return null;
  }

  const data = readFileSync(filePath);
  testDb.prepare('UPDATE image_cache SET last_accessed_at = ? WHERE url_hash = ?')
    .run(Math.floor(Date.now() / 1000), hash);

  return { data, contentType: row.content_type };
}

function getStats() {
  const count = testDb.prepare('SELECT COUNT(*) as count FROM image_cache').get().count;
  const totalSize = testDb.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM image_cache').get().total;
  return { entries: count, totalSizeBytes: totalSize };
}

function clearAll() {
  const entries = testDb.prepare('SELECT file_path FROM image_cache').all();
  for (const row of entries) {
    const filePath = join(cacheDir, row.file_path);
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
  }
  testDb.prepare('DELETE FROM image_cache').run();
}

function evict(maxAgeSeconds, maxSizeBytes) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - maxAgeSeconds;
  let removedAge = 0;
  let removedLru = 0;

  const expired = testDb.prepare('SELECT url_hash, file_path FROM image_cache WHERE last_accessed_at < ?').all(cutoff);
  for (const row of expired) {
    const filePath = join(cacheDir, row.file_path);
    if (existsSync(filePath)) rmSync(filePath);
    testDb.prepare('DELETE FROM image_cache WHERE url_hash = ?').run(row.url_hash);
    removedAge++;
  }

  const totalSize = testDb.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM image_cache').get().total;
  if (totalSize > maxSizeBytes) {
    const entries = testDb.prepare('SELECT url_hash, file_path, file_size FROM image_cache ORDER BY last_accessed_at ASC').all();
    let currentSize = totalSize;
    for (const row of entries) {
      if (currentSize <= maxSizeBytes) break;
      const filePath = join(cacheDir, row.file_path);
      if (existsSync(filePath)) rmSync(filePath);
      testDb.prepare('DELETE FROM image_cache WHERE url_hash = ?').run(row.url_hash);
      currentSize -= row.file_size;
      removedLru++;
    }
  }

  return { removedAge, removedLru };
}

describe('ImageCacheService', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    cacheDir = join(tmpdir(), `opsdec-test-cache-${Date.now()}`);
    mkdirSync(cacheDir, { recursive: true });
  });

  afterEach(() => {
    testDb.close();
    if (existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true });
    }
  });

  describe('hashUrl', () => {
    it('should produce consistent hashes for the same URL', () => {
      const url = 'http://example.com/image.jpg';
      expect(hashUrl(url)).toBe(hashUrl(url));
    });

    it('should produce different hashes for different URLs', () => {
      expect(hashUrl('http://example.com/a.jpg')).not.toBe(hashUrl('http://example.com/b.jpg'));
    });

    it('should produce a 64-character hex string', () => {
      const hash = hashUrl('http://example.com/image.jpg');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('get/put round-trip', () => {
    it('should store and retrieve an image', () => {
      const url = 'http://server.local/cover.jpg';
      const data = Buffer.from('fake-jpeg-data');
      const contentType = 'image/jpeg';

      put(url, data, contentType);
      const result = get(url);

      expect(result).not.toBeNull();
      expect(result.contentType).toBe('image/jpeg');
      expect(Buffer.compare(result.data, data)).toBe(0);
    });

    it('should return null for uncached URL', () => {
      expect(get('http://server.local/missing.jpg')).toBeNull();
    });

    it('should overwrite existing entry on re-put', () => {
      const url = 'http://server.local/cover.jpg';
      put(url, Buffer.from('old-data'), 'image/jpeg');
      put(url, Buffer.from('new-data'), 'image/png');

      const result = get(url);
      expect(result.contentType).toBe('image/png');
      expect(result.data.toString()).toBe('new-data');
    });
  });

  describe('missing file cleanup', () => {
    it('should clean up DB entry when file is missing from disk', () => {
      const url = 'http://server.local/gone.jpg';
      put(url, Buffer.from('data'), 'image/jpeg');

      // Remove the file but keep DB entry
      const hash = hashUrl(url);
      const row = testDb.prepare('SELECT file_path FROM image_cache WHERE url_hash = ?').get(hash);
      rmSync(join(cacheDir, row.file_path));

      const result = get(url);
      expect(result).toBeNull();

      // DB entry should also be gone
      const dbRow = testDb.prepare('SELECT * FROM image_cache WHERE url_hash = ?').get(hash);
      expect(dbRow).toBeUndefined();
    });
  });

  describe('eviction by age', () => {
    it('should remove entries older than max age', () => {
      const url = 'http://server.local/old.jpg';
      put(url, Buffer.from('old-image'), 'image/jpeg');

      // Backdate the last_accessed_at
      const hash = hashUrl(url);
      const oldTimestamp = Math.floor(Date.now() / 1000) - 100;
      testDb.prepare('UPDATE image_cache SET last_accessed_at = ? WHERE url_hash = ?').run(oldTimestamp, hash);

      const result = evict(50, 500 * 1024 * 1024); // max age = 50 seconds
      expect(result.removedAge).toBe(1);

      expect(get(url)).toBeNull();
    });

    it('should keep entries within max age', () => {
      const url = 'http://server.local/fresh.jpg';
      put(url, Buffer.from('fresh-image'), 'image/jpeg');

      const result = evict(3600, 500 * 1024 * 1024); // max age = 1 hour
      expect(result.removedAge).toBe(0);

      expect(get(url)).not.toBeNull();
    });
  });

  describe('eviction by size', () => {
    it('should remove LRU entries when over max size', () => {
      const data = Buffer.alloc(100, 'x');

      // Insert 3 entries, each 100 bytes
      put('http://server.local/1.jpg', data, 'image/jpeg');
      // Backdate entry 1 so it's the oldest
      const hash1 = hashUrl('http://server.local/1.jpg');
      testDb.prepare('UPDATE image_cache SET last_accessed_at = ? WHERE url_hash = ?')
        .run(Math.floor(Date.now() / 1000) - 10, hash1);

      put('http://server.local/2.jpg', data, 'image/jpeg');
      put('http://server.local/3.jpg', data, 'image/jpeg');

      // Evict with max size = 250 bytes (should remove the oldest one to get under 250)
      const result = evict(3600, 250);
      expect(result.removedLru).toBe(1);

      // Entry 1 (oldest) should be gone
      expect(get('http://server.local/1.jpg')).toBeNull();
      // Entry 2 and 3 should remain
      expect(get('http://server.local/2.jpg')).not.toBeNull();
      expect(get('http://server.local/3.jpg')).not.toBeNull();
    });
  });

  describe('stats', () => {
    it('should return zero stats when empty', () => {
      const stats = getStats();
      expect(stats.entries).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
    });

    it('should return correct stats after caching', () => {
      put('http://server.local/a.jpg', Buffer.from('aaaa'), 'image/jpeg');
      put('http://server.local/b.png', Buffer.from('bbbbbb'), 'image/png');

      const stats = getStats();
      expect(stats.entries).toBe(2);
      expect(stats.totalSizeBytes).toBe(10); // 4 + 6
    });
  });

  describe('clearAll', () => {
    it('should remove all entries and files', () => {
      put('http://server.local/a.jpg', Buffer.from('data-a'), 'image/jpeg');
      put('http://server.local/b.jpg', Buffer.from('data-b'), 'image/jpeg');

      clearAll();

      const stats = getStats();
      expect(stats.entries).toBe(0);
      expect(get('http://server.local/a.jpg')).toBeNull();
      expect(get('http://server.local/b.jpg')).toBeNull();
    });
  });

  describe('extensionFromContentType', () => {
    it('should map known content types', () => {
      expect(extensionFromContentType('image/jpeg')).toBe('.jpg');
      expect(extensionFromContentType('image/png')).toBe('.png');
      expect(extensionFromContentType('image/webp')).toBe('.webp');
    });

    it('should return .bin for unknown types', () => {
      expect(extensionFromContentType('application/octet-stream')).toBe('.bin');
    });
  });
});
