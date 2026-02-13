# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpsDec is a self-hosted media server monitoring and statistics platform inspired by Tautulli. It tracks activity from Plex, Emby, Audiobookshelf, and Sappho servers with real-time WebSocket monitoring, detailed statistics, and watch history.

**Tech Stack:**
- **Backend:** Node.js + Express, SQLite (better-sqlite3), WebSocket, node-cron
- **Frontend:** React 18 + Vite, TailwindCSS, Recharts, React Router
- **Deployment:** Docker + Docker Compose (production-ready)

## Development Commands

### Running the Application

```bash
# Install dependencies for both backend and frontend (npm workspaces)
npm install

# Development mode - runs both backend (port 3001) and frontend (port 3000) with hot reload
npm run dev

# Run only backend in development
npm run dev:backend

# Run only frontend in development
npm run dev:frontend

# Production build (builds frontend, backend serves it)
npm run build

# Start production server (backend serves built frontend from /frontend/dist)
npm start
```

### Container Commands

This project uses **Podman** (aliased as `docker`/`docker-compose` on this system). All `docker` and `docker-compose` commands work via podman aliases.

```bash
# Build image from source (required after code changes)
podman build --no-cache -t opsdec:local .

# Run the container locally for testing
podman run -d --name opsdec -p 3001:3001 -v ./data:/app/data -e JWT_SECRET=your-secret -e NODE_ENV=production opsdec:local

# View logs
podman logs opsdec --follow

# Stop and remove container
podman stop opsdec && podman rm opsdec

# Using docker-compose (works via podman alias)
docker-compose up -d
docker-compose down
```

**Important:** Docker/Podman only mounts the `./data` volume, not source code. After code changes, you MUST rebuild the image with `--no-cache` flag to ensure changes are included.

## Architecture

### High-Level Data Flow

1. **Service Layer** (`backend/src/services/`) - Each media server has a dedicated service class:
   - `EmbyService`, `PlexService`, `AudiobookshelfService`, `SapphoService`
   - Services poll their respective APIs or listen to WebSocket events
   - Parse server-specific data into a unified activity format

2. **Monitor Service** (`backend/src/services/monitor.js`) - Central coordinator:
   - Initializes all media server services from database or environment variables
   - Runs cron job (configurable via `POLL_INTERVAL`) to poll each service
   - Manages session state (playing/paused/stopped) and detects changes
   - Writes session data to SQLite `sessions` table
   - Records completed sessions to `history` table with filtering rules
   - Performs IP geolocation lookup for sessions (`geolocation.js`)
   - Broadcasts updates via WebSocket to connected frontend clients

3. **Database Layer** (`backend/src/database/init.js`):
   - SQLite with `better-sqlite3` (synchronous API)
   - **Critical:** Uses `journal_mode = DELETE` and `synchronous = FULL` for Docker volume compatibility on macOS (WAL mode causes corruption)
   - Auto-migration system checks for missing columns on startup and adds them
   - Tables: `sessions`, `history`, `users`, `servers`, `settings`, `user_mappings`, `library_stats`, `ip_cache`

4. **WebSocket Layer** (`backend/src/index.js`):
   - Real-time bidirectional communication on `ws://localhost:3001/ws`
   - Backend broadcasts activity updates when sessions change
   - Frontend subscribes to updates and refreshes UI without polling

5. **API Routes** (`backend/src/routes/api.js`):
   - RESTful endpoints for history, users, stats, settings, servers
   - Image proxy at `/proxy/image` to handle CORS and authentication for media thumbnails

### Media Server Integration

Each service extends a common pattern:
- **Polling-based:** Emby, Plex - actively poll `/Sessions` endpoint every N seconds
- **WebSocket-based:** Sappho - listens to real-time session updates from Sappho's WebSocket API
- **Hybrid:** Audiobookshelf - polls API but also handles WebSocket events for instant updates

**IP Address Detection:**
- Sappho/Audiobookshelf use `getClientIP()` helper to extract real client IP from proxy headers (X-Forwarded-For, X-Real-IP, CF-Connecting-IP)
- OpsDec classifies IPs as LAN/WAN using `isPrivateIP()` check
- Geolocation service caches lookups in `ip_cache` table
- LAN connections display "Local Network" instead of failed geolocation

### Session Lifecycle

1. **Session Start:** Service detects new playback, creates entry in `sessions` table with `state='playing'`
2. **Session Updates:** Position, progress, state changes update existing session row
3. **Session End:** When session stops or is no longer reported:
   - Check if it meets history filter criteria (`shouldAddToHistory()`)
   - If yes, insert into `history` table with completion data
   - Mark session as `state='stopped'`, set `stopped_at` timestamp
   - Session remains in `sessions` table for historical reference

### History Filtering

Located in `monitor.js`, the `shouldAddToHistory()` function filters sessions based on:
- **User preference:** `users.history_enabled` flag (can disable per-user)
- **Exclusion patterns:** Title contains configurable patterns (e.g., "theme", "preview", "trailer")
- **Minimum duration:** `stream_duration` (actual playback time) must exceed threshold (default 30s)
- **Minimum progress:** `progressPercent` must exceed threshold (default 10%) - skipped for audiobooks/tracks

Settings stored in `settings` table with keys: `history_min_duration`, `history_min_percent`, `history_exclusion_patterns`, `history_group_successive`

### Server Configuration

Two methods (can be used simultaneously):

1. **Environment Variables** (docker-compose.yml):
   - `EMBY_URL`, `EMBY_API_KEY`
   - `PLEX_URL`, `PLEX_TOKEN`
   - `AUDIOBOOKSHELF_URL`, `AUDIOBOOKSHELF_API_KEY`
   - Auto-migrated to `servers` table with `env_variable=1` flag on startup

2. **UI Configuration** (Settings page):
   - Add/edit/delete servers via `/api/servers` endpoints
   - Stored in `servers` table with `env_variable=0`

## Important Implementation Details

### Database Migrations

All migrations run automatically in `initDatabase()` on server startup. Pattern:
```javascript
const columns = db.prepare("PRAGMA table_info(table_name)").all();
const columnNames = columns.map(col => col.name);
if (!columnNames.includes('new_column')) {
  db.exec('ALTER TABLE table_name ADD COLUMN new_column TYPE');
}
```

**Never use WAL mode with Docker volumes on macOS** - causes corruption. Use `journal_mode = DELETE` with `synchronous = FULL`.

### Frontend Location Data Display

`Dashboard.jsx` line 196: Location data (IP, city, region, country) is displayed for all server types. Previously Sappho was excluded - ensure no `session.server_type !== 'sappho'` condition exists in location rendering.

### WebSocket Broadcasting

Backend exports `broadcast()` function from `index.js` that services import to push updates:
```javascript
import { broadcast } from '../index.js';
broadcast({ type: 'session.update', data: sessions });
```

Frontend connects via `useEffect` hook in components, listens for messages, updates state.

### User Mappings

`user_mappings` table allows unifying usernames across different servers (e.g., "john" on Plex, "john.doe" on Emby → both map to "John"). Has `preferred_avatar_server` to choose which server's avatar to display.

## Key Files Reference

- `backend/src/index.js` - Express server, WebSocket setup, production static file serving
- `backend/src/database/init.js` - Database schema, migrations, pragma settings
- `backend/src/services/monitor.js` - Session tracking orchestrator, history recording
- `backend/src/services/sappho.js` - Sappho audiobook server integration (WebSocket-based)
- `backend/src/services/geolocation.js` - IP geolocation with caching
- `frontend/src/pages/Dashboard.jsx` - Main dashboard with live activity cards
- `frontend/src/pages/History.jsx` - Watch history with filtering/pagination/search
- `frontend/src/pages/Settings.jsx` - Server management, history filter settings, user mappings

## Verification Checklist

Before completing work, run these checks:

```bash
# Run all tests (backend + frontend)
npm test

# Lint check — must pass with 0 errors, 0 warnings
npm run lint

# Security audit — check for high/critical vulnerabilities
npm run audit:check
```

All three must pass cleanly before committing. Fix any lint errors or test failures before marking work as done.

### Fixing Lint Issues
- `npm run lint:fix` auto-fixes formatting issues
- Unused imports: remove them, don't prefix with `_` (except intentional re-render triggers like `useTimezone()`)
- Unused catch parameters: use bare `catch {` instead of `catch (error) {}`
- Unreachable code: remove dead code after unconditional returns

## Common Pitfalls

1. **Docker cache issues:** Always use `--no-cache` when rebuilding after code changes
2. **Database corruption:** If using Docker on macOS, ensure `journal_mode = DELETE` and `synchronous = FULL`
3. **Missing IP addresses:** Check reverse proxy forwards X-Forwarded-For header; verify `getClientIP()` in service code
4. **WebSocket connection failures:** Frontend expects WebSocket on same host as API (port 3001); check CORS settings
5. **History not recording:** Verify session meets filter criteria in `shouldAddToHistory()` - check logs for "Skipped history" messages
