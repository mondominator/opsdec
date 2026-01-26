import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const dbPath = process.env.DB_PATH || '/app/data/opsdec.db';

// Ensure data directory exists
const dir = dirname(dbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

export const db = new Database(dbPath);
// Use DELETE journal mode instead of WAL for better Docker volume compatibility
// WAL mode can cause corruption issues with Docker volumes, especially on macOS
db.pragma('journal_mode = DELETE');
db.pragma('synchronous = FULL'); // Maximum safety for Docker volumes on macOS
db.pragma('cache_size = -64000'); // 64MB cache
db.pragma('temp_store = MEMORY'); // Store temp tables in memory

export function initDatabase() {
  console.log('🗄️  Initializing database...');

  // Sessions table - tracks individual playback sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT UNIQUE NOT NULL,
      server_type TEXT NOT NULL, -- 'emby' or 'audiobookshelf'
      server_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      media_type TEXT NOT NULL, -- 'movie', 'episode', 'track', 'audiobook'
      media_id TEXT NOT NULL,
      title TEXT NOT NULL,
      parent_title TEXT, -- show name for episodes
      grandparent_title TEXT, -- series name
      year INTEGER,
      thumb TEXT,
      art TEXT,
      started_at INTEGER NOT NULL, -- unix timestamp
      stopped_at INTEGER,
      paused_counter INTEGER DEFAULT 0,
      state TEXT NOT NULL, -- 'playing', 'paused', 'stopped', 'buffering'
      progress_percent INTEGER DEFAULT 0,
      duration INTEGER, -- in seconds
      current_time INTEGER DEFAULT 0, -- current playback position in seconds
      playback_time INTEGER DEFAULT 0, -- actual playback time in seconds (excludes pauses)
      last_position_update INTEGER, -- timestamp of last position update
      bitrate TEXT, -- bitrate in Mbps
      transcoding INTEGER DEFAULT 0, -- boolean: is transcoding
      video_codec TEXT,
      audio_codec TEXT,
      container TEXT,
      resolution TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Activity history table - aggregated playback history
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
      country TEXT
    )
  `);

  // Users table - cache user information
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      server_type TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT,
      thumb TEXT,
      is_admin INTEGER DEFAULT 0,
      history_enabled INTEGER DEFAULT 1, -- toggle history tracking per user
      last_seen INTEGER,
      total_plays INTEGER DEFAULT 0,
      total_duration INTEGER DEFAULT 0, -- in seconds
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Media library stats
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

  // Server configuration
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL, -- 'emby' or 'audiobookshelf'
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_sync INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Application settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // IP geolocation cache - avoid repeated API lookups
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

  // Ignored ABS sessions - track deleted history entries to prevent re-import
  db.exec(`
    CREATE TABLE IF NOT EXISTS ignored_abs_sessions (
      session_id TEXT PRIMARY KEY,
      title TEXT,
      deleted_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // User mappings - map usernames from different servers to a unified username
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      primary_username TEXT NOT NULL,
      mapped_username TEXT NOT NULL,
      server_type TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(mapped_username, server_type)
    )
  `);

  // Create indexes for better query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);
    CREATE INDEX IF NOT EXISTS idx_history_watched ON history(watched_at);
    CREATE INDEX IF NOT EXISTS idx_users_server ON users(server_type);
    CREATE INDEX IF NOT EXISTS idx_user_mappings_mapped ON user_mappings(mapped_username);
    CREATE INDEX IF NOT EXISTS idx_user_mappings_primary ON user_mappings(primary_username);
  `);

  // Migrations - add missing columns if they don't exist
  try {
    // Check if season_number column exists
    const columns = db.prepare("PRAGMA table_info(sessions)").all();
    const columnNames = columns.map(col => col.name);

    if (!columnNames.includes('season_number')) {
      console.log('🔧 Adding season_number column...');
      db.exec('ALTER TABLE sessions ADD COLUMN season_number INTEGER');
    }

    if (!columnNames.includes('episode_number')) {
      console.log('🔧 Adding episode_number column...');
      db.exec('ALTER TABLE sessions ADD COLUMN episode_number INTEGER');
    }

    if (!columnNames.includes('current_time')) {
      console.log('🔧 Adding current_time column...');
      db.exec('ALTER TABLE sessions ADD COLUMN current_time INTEGER DEFAULT 0');
    }

    if (!columnNames.includes('bitrate')) {
      console.log('🔧 Adding bitrate column...');
      db.exec('ALTER TABLE sessions ADD COLUMN bitrate TEXT');
    }

    if (!columnNames.includes('transcoding')) {
      console.log('🔧 Adding transcoding column...');
      db.exec('ALTER TABLE sessions ADD COLUMN transcoding INTEGER DEFAULT 0');
    }

    if (!columnNames.includes('video_codec')) {
      console.log('🔧 Adding video_codec column...');
      db.exec('ALTER TABLE sessions ADD COLUMN video_codec TEXT');
    }

    if (!columnNames.includes('audio_codec')) {
      console.log('🔧 Adding audio_codec column...');
      db.exec('ALTER TABLE sessions ADD COLUMN audio_codec TEXT');
    }

    if (!columnNames.includes('container')) {
      console.log('🔧 Adding container column...');
      db.exec('ALTER TABLE sessions ADD COLUMN container TEXT');
    }

    if (!columnNames.includes('resolution')) {
      console.log('🔧 Adding resolution column...');
      db.exec('ALTER TABLE sessions ADD COLUMN resolution TEXT');
    }

    if (!columnNames.includes('user_thumb')) {
      console.log('🔧 Adding user_thumb column...');
      db.exec('ALTER TABLE sessions ADD COLUMN user_thumb TEXT');
    }

    if (!columnNames.includes('playback_time')) {
      console.log('🔧 Adding playback_time column...');
      db.exec('ALTER TABLE sessions ADD COLUMN playback_time INTEGER DEFAULT 0');
    }

    if (!columnNames.includes('last_position_update')) {
      console.log('🔧 Adding last_position_update column...');
      db.exec('ALTER TABLE sessions ADD COLUMN last_position_update INTEGER');
    }

    // Add history_enabled column to users table if it doesn't exist
    const userColumns = db.prepare('PRAGMA table_info(users)').all();
    const userColumnNames = userColumns.map(col => col.name);

    if (!userColumnNames.includes('history_enabled')) {
      console.log('🔧 Adding history_enabled column to users...');
      db.exec('ALTER TABLE users ADD COLUMN history_enabled INTEGER DEFAULT 1');
    }

    // Add preferred_avatar_server column to user_mappings table if it doesn't exist
    const mappingColumns = db.prepare('PRAGMA table_info(user_mappings)').all();
    const mappingColumnNames = mappingColumns.map(col => col.name);

    if (!mappingColumnNames.includes('preferred_avatar_server')) {
      console.log('🔧 Adding preferred_avatar_server column to user_mappings...');
      db.exec('ALTER TABLE user_mappings ADD COLUMN preferred_avatar_server TEXT DEFAULT "plex"');
    }

    // Add stream_duration column to history table if it doesn't exist
    const historyColumns = db.prepare('PRAGMA table_info(history)').all();
    const historyColumnNames = historyColumns.map(col => col.name);

    if (!historyColumnNames.includes('stream_duration')) {
      console.log('🔧 Adding stream_duration column to history...');
      db.exec('ALTER TABLE history ADD COLUMN stream_duration INTEGER'); // in seconds
    }

    if (!historyColumnNames.includes('ip_address')) {
      console.log('🔧 Adding ip_address column to history...');
      db.exec('ALTER TABLE history ADD COLUMN ip_address TEXT');
    }

    if (!historyColumnNames.includes('location')) {
      console.log('🔧 Adding location column to history...');
      db.exec('ALTER TABLE history ADD COLUMN location TEXT'); // 'lan' or 'wan'
    }

    if (!historyColumnNames.includes('city')) {
      console.log('🔧 Adding city column to history...');
      db.exec('ALTER TABLE history ADD COLUMN city TEXT');
    }

    if (!historyColumnNames.includes('region')) {
      console.log('🔧 Adding region column to history...');
      db.exec('ALTER TABLE history ADD COLUMN region TEXT'); // state/province
    }

    if (!historyColumnNames.includes('country')) {
      console.log('🔧 Adding country column to history...');
      db.exec('ALTER TABLE history ADD COLUMN country TEXT');
    }

    if (!historyColumnNames.includes('abs_session_ids')) {
      console.log('🔧 Adding abs_session_ids column to history (for Audiobookshelf consolidation)...');
      db.exec('ALTER TABLE history ADD COLUMN abs_session_ids TEXT'); // Comma-separated list of processed ABS session IDs
    }

    // Add location fields to sessions table
    if (!columnNames.includes('ip_address')) {
      console.log('🔧 Adding ip_address column to sessions...');
      db.exec('ALTER TABLE sessions ADD COLUMN ip_address TEXT');
    }

    if (!columnNames.includes('location')) {
      console.log('🔧 Adding location column to sessions...');
      db.exec('ALTER TABLE sessions ADD COLUMN location TEXT'); // 'lan' or 'wan'
    }

    if (!columnNames.includes('city')) {
      console.log('🔧 Adding city column to sessions...');
      db.exec('ALTER TABLE sessions ADD COLUMN city TEXT');
    }

    if (!columnNames.includes('region')) {
      console.log('🔧 Adding region column to sessions...');
      db.exec('ALTER TABLE sessions ADD COLUMN region TEXT'); // state/province
    }

    if (!columnNames.includes('country')) {
      console.log('🔧 Adding country column to sessions...');
      db.exec('ALTER TABLE sessions ADD COLUMN country TEXT');
    }
  } catch (error) {
    console.error('Migration error:', error.message);
  }

  // Migrate user_mappings table to have composite unique constraint
  try {
    // Check if the old unique constraint exists by trying to query the schema
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_mappings'").get();

    if (tableInfo && tableInfo.sql.includes('mapped_username TEXT NOT NULL UNIQUE')) {
      console.log('🔧 Migrating user_mappings table to use composite unique constraint...');

      // Get existing data
      const existingMappings = db.prepare('SELECT * FROM user_mappings').all();

      // Drop and recreate the table with new schema
      db.exec('DROP TABLE IF EXISTS user_mappings');
      db.exec(`
        CREATE TABLE user_mappings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          primary_username TEXT NOT NULL,
          mapped_username TEXT NOT NULL,
          server_type TEXT NOT NULL,
          created_at INTEGER DEFAULT (strftime('%s', 'now')),
          UNIQUE(mapped_username, server_type)
        )
      `);

      // Restore data
      const insert = db.prepare('INSERT INTO user_mappings (id, primary_username, mapped_username, server_type, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const mapping of existingMappings) {
        // Make sure server_type is not null
        const serverType = mapping.server_type || 'unknown';
        insert.run(mapping.id, mapping.primary_username, mapping.mapped_username, serverType, mapping.created_at);
      }

      console.log(`✅ Migrated ${existingMappings.length} user mappings`);
    }
  } catch (error) {
    console.error('User mappings migration error:', error.message);
  }

  // Remove foreign key constraint from history table
  try {
    const historySchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='history'").get();

    if (historySchema && historySchema.sql.includes('FOREIGN KEY')) {
      console.log('🔧 Removing foreign key constraint from history table...');

      // Get existing history data
      const existingHistory = db.prepare('SELECT * FROM history').all();

      // Drop and recreate the table without foreign key
      db.exec('DROP TABLE IF EXISTS history');
      db.exec(`
        CREATE TABLE history (
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
          country TEXT
        )
      `);

      // Restore data
      const insert = db.prepare(`INSERT INTO history (
        id, session_id, server_type, user_id, username, media_type, media_id,
        title, parent_title, grandparent_title, watched_at, duration, percent_complete,
        thumb, stream_duration, ip_address, location, city, region, country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

      for (const record of existingHistory) {
        insert.run(
          record.id, record.session_id, record.server_type, record.user_id,
          record.username, record.media_type, record.media_id, record.title,
          record.parent_title, record.grandparent_title, record.watched_at,
          record.duration, record.percent_complete, record.thumb,
          record.stream_duration, record.ip_address, record.location,
          record.city, record.region, record.country
        );
      }

      console.log(`✅ Migrated ${existingHistory.length} history records without foreign key constraint`);
    }
  } catch (error) {
    console.error('History table migration error:', error.message);
  }

  // Initialize default history filter settings if they don't exist
  try {
    const settingsKeys = ['history_min_duration', 'history_min_percent', 'history_exclusion_patterns', 'history_group_successive'];
    const defaults = {
      history_min_duration: '30',
      history_min_percent: '10',
      history_exclusion_patterns: 'theme,preview,trailer',
      history_group_successive: '1'
    };

    for (const key of settingsKeys) {
      const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      if (!existing) {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, defaults[key]);
        console.log(`🔧 Initialized default setting: ${key} = ${defaults[key]}`);
      }
    }
  } catch (error) {
    console.error('Settings initialization error:', error.message);
  }

  console.log('✅ Database initialized successfully');
}

export default db;
