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
db.pragma('journal_mode = WAL');

// Configure WAL to checkpoint more frequently for data safety
db.pragma('wal_autocheckpoint = 1000'); // Checkpoint every 1000 pages
db.pragma('synchronous = NORMAL'); // Good balance of safety and performance

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
      FOREIGN KEY (session_id) REFERENCES sessions(id)
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

  // Create indexes for better query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);
    CREATE INDEX IF NOT EXISTS idx_history_watched ON history(watched_at);
    CREATE INDEX IF NOT EXISTS idx_users_server ON users(server_type);
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
  } catch (error) {
    console.error('Migration error:', error.message);
  }

  console.log('✅ Database initialized successfully');
}

export default db;
