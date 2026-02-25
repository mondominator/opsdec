import Database from 'better-sqlite3';

/**
 * Create a fresh in-memory SQLite database with the same schema as production.
 * Returns the db instance ready for use in tests.
 */
export function createTestDatabase() {
  const db = new Database(':memory:');

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT UNIQUE NOT NULL,
      server_type TEXT NOT NULL,
      server_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      user_thumb TEXT,
      media_type TEXT NOT NULL,
      media_id TEXT NOT NULL,
      title TEXT NOT NULL,
      parent_title TEXT,
      grandparent_title TEXT,
      season_number INTEGER,
      episode_number INTEGER,
      year INTEGER,
      thumb TEXT,
      art TEXT,
      started_at INTEGER NOT NULL,
      stopped_at INTEGER,
      paused_counter INTEGER DEFAULT 0,
      state TEXT NOT NULL,
      progress_percent INTEGER DEFAULT 0,
      duration INTEGER,
      current_time INTEGER DEFAULT 0,
      playback_time INTEGER DEFAULT 0,
      last_position_update INTEGER,
      bitrate TEXT,
      transcoding INTEGER DEFAULT 0,
      video_codec TEXT,
      audio_codec TEXT,
      container TEXT,
      resolution TEXT,
      ip_address TEXT,
      location TEXT,
      city TEXT,
      region TEXT,
      country TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // History table
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      server_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      media_type TEXT NOT NULL,
      media_id TEXT NOT NULL,
      title TEXT NOT NULL,
      parent_title TEXT,
      grandparent_title TEXT,
      watched_at INTEGER NOT NULL,
      duration INTEGER,
      percent_complete INTEGER,
      thumb TEXT,
      stream_duration INTEGER,
      ip_address TEXT,
      location TEXT,
      city TEXT,
      region TEXT,
      country TEXT,
      abs_session_ids TEXT
    )
  `);

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      server_type TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT,
      thumb TEXT,
      is_admin INTEGER DEFAULT 0,
      history_enabled INTEGER DEFAULT 1,
      last_seen INTEGER,
      total_plays INTEGER DEFAULT 0,
      total_duration INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Servers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_sync INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Auth users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      avatar TEXT,
      last_login INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Refresh tokens table
  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
    )
  `);

  // User mappings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      primary_username TEXT NOT NULL,
      mapped_username TEXT NOT NULL,
      server_type TEXT NOT NULL,
      preferred_avatar_server TEXT DEFAULT 'plex',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(mapped_username, server_type)
    )
  `);

  // IP cache table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ip_cache (
      ip_address TEXT PRIMARY KEY,
      city TEXT,
      region TEXT,
      country TEXT,
      country_code TEXT,
      timezone TEXT,
      isp TEXT,
      lookup_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Ignored ABS sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS ignored_abs_sessions (
      session_id TEXT PRIMARY KEY,
      title TEXT,
      deleted_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Library stats
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_type TEXT NOT NULL,
      library_name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Scheduled jobs
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cron_schedule TEXT NOT NULL,
      last_run INTEGER,
      last_status TEXT,
      last_result TEXT,
      last_duration INTEGER,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Image cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_cache (
      url_hash TEXT PRIMARY KEY,
      original_url TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      last_accessed_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  return db;
}

/**
 * Seed the test database with default history filter settings.
 */
export function seedDefaultSettings(db) {
  const defaults = {
    history_min_duration: '30',
    history_min_percent: '10',
    history_exclusion_patterns: 'theme,preview,trailer',
    history_group_successive: '1',
  };

  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) {
    stmt.run(key, value);
  }
}
