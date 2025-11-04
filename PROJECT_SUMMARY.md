# OpsDec - Project Summary

## Overview

OpsDec is a modern, self-hosted media server monitoring platform inspired by Tautulli. It provides real-time activity monitoring, detailed statistics, and comprehensive watch history for Plex and Emby media servers.

## What's Been Built

### Backend (Node.js + Express)

**Core Features:**
- RESTful API with Express.js
- WebSocket server for real-time updates
- SQLite database with comprehensive schema
- Multi-server support (Plex + Emby + Audiobookshelf)
- Automatic activity polling and monitoring
- Session tracking and history aggregation

**Services:**
- `emby.js` - Full Emby API integration
- `plex.js` - Full Plex API integration
- `audiobookshelf.js` - Full Audiobookshelf API integration
- `monitor.js` - Unified monitoring service that supports all platforms

**Database Schema:**
- `sessions` - Active playback sessions
- `history` - Historical playback data
- `users` - User statistics and information
- `library_stats` - Library metadata
- `servers` - Server configuration

### Frontend (React + Vite + TailwindCSS)

**Pages:**
- **Dashboard** - Overview with stats, charts, and current activity
- **Activity** - Real-time view of active streams
- **History** - Complete playback history with pagination
- **Users** - User list with statistics
- **UserDetail** - Individual user analytics

**Features:**
- Dark theme inspired by Tautulli
- Responsive design
- Real-time WebSocket updates
- Interactive charts (Recharts)
- Clean, modern UI with Lucide icons

### Docker Support

**Files:**
- `Dockerfile` - Multi-stage build (frontend + backend)
- `docker-compose.yml` - Easy deployment configuration
- `.dockerignore` - Optimized build context
- `DOCKER.md` - Comprehensive Docker guide

**Features:**
- Production-ready container
- Health checks
- Proper signal handling (dumb-init)
- Volume persistence for database
- Non-root user for security

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OpsDec                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐          ┌──────────────┐               │
│  │   Frontend   │ ◄────────┤   Backend    │               │
│  │   (React)    │  HTTP/WS │  (Express)   │               │
│  └──────────────┘          └──────┬───────┘               │
│                                    │                        │
│                          ┌─────────┴──────────┐            │
│                          │                    │            │
│                    ┌─────▼─────┐        ┌────▼────┐       │
│                    │   Plex    │        │  Emby   │       │
│                    │  Service  │        │ Service │       │
│                    └─────┬─────┘        └────┬────┘       │
│                          │                   │            │
│                          └─────────┬─────────┘            │
│                                    │                      │
│                              ┌─────▼─────┐               │
│                              │  SQLite   │               │
│                              │  Database │               │
│                              └───────────┘               │
└─────────────────────────────────────────────────────────────┘
         │                              │
         │                              │
    ┌────▼─────┐                  ┌────▼─────┐
    │   Plex   │                  │   Emby   │
    │  Server  │                  │  Server  │
    └──────────┘                  └──────────┘
```

## Key Technologies

### Backend
- **Node.js 18+** - Runtime environment
- **Express.js** - Web framework
- **better-sqlite3** - Fast, synchronous SQLite3
- **ws** - WebSocket implementation
- **node-cron** - Job scheduling
- **axios** - HTTP client for API calls
- **dotenv** - Environment configuration

### Frontend
- **React 18** - UI library
- **Vite** - Build tool and dev server
- **TailwindCSS** - Utility-first CSS
- **Recharts** - Charting library
- **React Router** - Client-side routing
- **Lucide React** - Icon library
- **date-fns** - Date formatting

### DevOps
- **Docker** - Containerization
- **Docker Compose** - Multi-container orchestration
- **npm workspaces** - Monorepo management

## API Endpoints

### Activity & Sessions
- `GET /api/activity` - Current active sessions
- `GET /api/history` - Watch history (paginated)

### Users
- `GET /api/users` - All users
- `GET /api/users/:id/stats` - User statistics

### Statistics
- `GET /api/stats/dashboard` - Dashboard overview

### Media Servers
- `GET /api/emby/test` - Test Emby connection
- `GET /api/emby/libraries` - Emby libraries
- `GET /api/media/recent` - Recently added media

### Real-time
- `WS /ws` - WebSocket for live updates

## Configuration

### Environment Variables

```env
# Server
PORT=3001
NODE_ENV=production

# Database
DB_PATH=/app/backend/data/opsdec.db

# Plex (optional)
PLEX_URL=http://plex-server:32400
PLEX_TOKEN=your_plex_token

# Emby (optional)
EMBY_URL=http://emby-server:8096
EMBY_API_KEY=your_emby_api_key

# Audiobookshelf (optional)
AUDIOBOOKSHELF_URL=http://audiobookshelf-server:13378
AUDIOBOOKSHELF_TOKEN=your_audiobookshelf_token

# Monitoring
POLL_INTERVAL=30
```

## Deployment Options

### 1. Docker (Recommended)
```bash
docker-compose up -d
```

### 2. Manual
```bash
npm install
npm run build
NODE_ENV=production npm start
```

### 3. Development
```bash
npm install
npm run dev
```

## Features Implemented

✅ **Multi-server support** - Monitor Plex, Emby, and Audiobookshelf simultaneously
✅ **Real-time monitoring** - Live activity updates via WebSocket
✅ **Session tracking** - Detailed playback session information
✅ **Watch history** - Complete historical data with advanced filtering and search
✅ **User statistics** - Per-user analytics and insights with sortable columns
✅ **Dashboard** - Overview with charts, metrics, and server branding
✅ **Docker support** - Production-ready containerization
✅ **Dark theme UI** - Tautulli-inspired interface
✅ **RESTful API** - Well-structured backend API
✅ **Database persistence** - SQLite with proper schema
✅ **Advanced search** - Full-text search across media and users
✅ **Flexible pagination** - Multiple page size options
✅ **Server logos** - Visual identification of media servers

## Future Enhancements

🔮 **Planned Features:**
- [ ] Jellyfin support
- [ ] Email/Discord notifications
- [ ] Export to CSV/JSON
- [ ] User authentication
- [ ] Custom dashboard widgets
- [ ] Mobile app
- [ ] Theme customization
- [ ] Multi-language support
- [ ] Date range filtering

## File Structure

```
opsdec/
├── backend/
│   ├── src/
│   │   ├── database/
│   │   │   └── init.js
│   │   ├── routes/
│   │   │   └── api.js
│   │   ├── services/
│   │   │   ├── emby.js
│   │   │   ├── plex.js
│   │   │   ├── audiobookshelf.js
│   │   │   └── monitor.js
│   │   └── index.js
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── public/
│   │   └── favicon.svg
│   ├── src/
│   │   ├── components/
│   │   │   └── Layout.jsx
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Activity.jsx
│   │   │   ├── History.jsx
│   │   │   ├── Users.jsx
│   │   │   └── UserDetail.jsx
│   │   ├── utils/
│   │   │   ├── api.js
│   │   │   └── format.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── package.json
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .gitignore
├── package.json
├── setup.sh
├── README.md
├── QUICKSTART.md
├── DOCKER.md
└── PROJECT_SUMMARY.md
```

## Getting Started

See:
- [README.md](README.md) - Main documentation
- [QUICKSTART.md](QUICKSTART.md) - Quick start guide
- [DOCKER.md](DOCKER.md) - Docker deployment guide

## Security Considerations

- ✅ Non-root user in Docker container
- ✅ Read-only environment file mounting
- ✅ No hardcoded credentials
- ✅ CORS configured
- ⚠️ No authentication (add reverse proxy with auth for production)
- ⚠️ API tokens stored in environment (use secrets management in production)

## Performance

- **Database**: SQLite with WAL mode for better concurrency
- **Polling**: Configurable interval (default 30s)
- **WebSocket**: Efficient real-time updates
- **Frontend**: Vite for fast builds and HMR
- **Docker**: Multi-stage build for smaller image size

## License

MIT License - Free for personal and commercial use

## Credits

- Inspired by [Tautulli](https://tautulli.com/)
- Built with modern web technologies
- Community-driven development

---

**Version:** 0.1.0
**Status:** Production-ready
**Docker:** Yes
**License:** MIT
