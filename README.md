# OpsDec

A modern, self-hosted media server monitoring and statistics platform inspired by Tautulli. Track your Plex, Emby, and Audiobookshelf server activity with real-time monitoring, detailed statistics, and a beautiful dark-themed interface.

![OpsDec](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Docker](https://img.shields.io/badge/docker-ready-blue)

## Features

- 📊 **Real-time Activity Monitoring** - Track current playback sessions in real-time
- 📈 **Detailed Statistics** - View comprehensive statistics for users and media
- 👥 **User Management** - Monitor individual user activity and watch history
- 📜 **Watch History** - Complete history of all playback sessions
- 🎨 **Tautulli-inspired UI** - Dark, modern interface with smooth animations
- 🔌 **Multi-Server Support** - Supports Plex, Emby, and Audiobookshelf
- 🐳 **Docker Ready** - Easy deployment with Docker and Docker Compose
- 🚀 **Fast & Lightweight** - Built with React and Express.js
- 💾 **SQLite Database** - Simple, file-based database with no external dependencies

## Tech Stack

### Backend
- Node.js with Express.js
- SQLite3 with better-sqlite3
- WebSocket for real-time updates
- Node-cron for scheduled tasks
- Axios for API calls

### Frontend
- React 18
- Vite for fast development
- TailwindCSS for styling
- Recharts for data visualization
- React Router for navigation
- Lucide React for icons

## Prerequisites

- **For Docker:** Docker and Docker Compose
- **For Manual Install:** Node.js 18.0.0 or higher
- **Media Server:** Plex Media Server, Emby Media Server, and/or Audiobookshelf with API access

## Installation

### Option 1: Docker (Recommended)

The easiest way to run OpsDec is with Docker:

#### Using Docker Compose

1. Create a `docker-compose.yml` file or use the provided one
2. Create a `.env` file with your configuration:

```env
# Plex Configuration (optional)
PLEX_URL=http://your-plex-server:32400
PLEX_TOKEN=your_plex_token

# Emby Configuration (optional)
EMBY_URL=http://your-emby-server:8096
EMBY_API_KEY=your_emby_api_key

# Audiobookshelf Configuration (optional)
AUDIOBOOKSHELF_URL=http://your-audiobookshelf-server:13378
AUDIOBOOKSHELF_TOKEN=your_audiobookshelf_token

# Polling interval (seconds)
POLL_INTERVAL=30
```

3. Start the container:

```bash
docker-compose up -d
```

4. Access at `http://localhost:3001`

#### Using Docker CLI

```bash
docker build -t opsdec .

docker run -d \
  --name opsdec \
  -p 3001:3001 \
  -v $(pwd)/data:/app/backend/data \
  -e PLEX_URL=http://your-plex-server:32400 \
  -e PLEX_TOKEN=your_plex_token \
  -e EMBY_URL=http://your-emby-server:8096 \
  -e EMBY_API_KEY=your_emby_api_key \
  -e AUDIOBOOKSHELF_URL=http://your-audiobookshelf-server:13378 \
  -e AUDIOBOOKSHELF_TOKEN=your_audiobookshelf_token \
  opsdec
```

### Option 2: Manual Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd opsdec
```

### 2. Install dependencies

```bash
npm install
```

This will install dependencies for both the backend and frontend using npm workspaces.

### 3. Configure the backend

Create a `.env` file in the `backend` directory:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your configuration:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Database
DB_PATH=./data/opsdec.db

# Plex Configuration (optional - leave blank if not using)
PLEX_URL=http://localhost:32400
PLEX_TOKEN=your_plex_token_here

# Emby Configuration (optional - leave blank if not using)
EMBY_URL=http://localhost:8096
EMBY_API_KEY=your_emby_api_key_here

# Audiobookshelf Configuration (optional - leave blank if not using)
AUDIOBOOKSHELF_URL=http://localhost:13378
AUDIOBOOKSHELF_TOKEN=your_audiobookshelf_token_here

# Polling interval in seconds
POLL_INTERVAL=30
```

#### Getting your Plex Token:

1. Sign in to Plex Web App
2. Open any media item
3. Click the three dots (•••) → "Get Info"
4. Click "View XML"
5. In the URL, find `X-Plex-Token=xxxxx` - that's your token

**Alternative method:**
```bash
# Get token via curl (replace username and password)
curl -X POST \
  'https://plex.tv/users/sign_in.xml' \
  -H 'X-Plex-Client-Identifier: opsdec' \
  -d 'user[login]=your_email' \
  -d 'user[password]=your_password'
```
Look for `<authentication-token>` in the response.

#### Getting your Emby API Key:

1. Log into your Emby server
2. Go to **Settings** → **Advanced** → **API Keys**
3. Click **New API Key**
4. Enter "OpsDec" as the app name
5. Copy the generated API key

#### Getting your Audiobookshelf Token:

1. Log into your Audiobookshelf server
2. Click on your profile icon (top right)
3. Go to **Settings** → **Account**
4. Click **Generate New API Token**
5. Copy the generated token

### 4. Start the application

For development (runs both backend and frontend):

```bash
npm run dev
```

This will start:
- Backend API server on `http://localhost:3001`
- Frontend development server on `http://localhost:3000`

## Multi-Server Configuration

OpsDec can monitor multiple media servers simultaneously. You can configure:

- **Plex only** - Set `PLEX_URL` and `PLEX_TOKEN`, leave others blank
- **Emby only** - Set `EMBY_URL` and `EMBY_API_KEY`, leave others blank
- **Audiobookshelf only** - Set `AUDIOBOOKSHELF_URL` and `AUDIOBOOKSHELF_TOKEN`, leave others blank
- **Any combination** - Configure whichever servers you want to monitor

Activity from all configured servers will be aggregated in a single dashboard.

## Production Deployment

### Docker Production (Recommended)

The Docker image is production-ready and has `NODE_ENV=production` set by default. No additional configuration needed!

### Manual Production Build

```bash
# Build the frontend
npm run build

# Set environment to production
export NODE_ENV=production

# Start the backend (will serve built frontend)
npm start
```

The backend automatically serves the frontend in production mode from the `/frontend/dist` directory.

## Project Structure

```
opsdec/
├── backend/
│   ├── src/
│   │   ├── database/
│   │   │   └── init.js          # Database schema and initialization
│   │   ├── routes/
│   │   │   └── api.js           # API endpoints
│   │   ├── services/
│   │   │   ├── emby.js          # Emby API integration
│   │   │   ├── plex.js          # Plex API integration
│   │   │   ├── audiobookshelf.js # Audiobookshelf API integration
│   │   │   └── monitor.js       # Activity monitoring service
│   │   └── index.js             # Express server and WebSocket
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── Layout.jsx       # Main layout component
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx    # Dashboard with stats
│   │   │   ├── Activity.jsx     # Current activity view
│   │   │   ├── History.jsx      # Watch history
│   │   │   ├── Users.jsx        # User list
│   │   │   └── UserDetail.jsx   # Individual user stats
│   │   ├── utils/
│   │   │   ├── api.js           # API client
│   │   │   └── format.js        # Formatting utilities
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
├── package.json
└── README.md
```

## Features Overview

### Dashboard
- Live activity counter
- Total plays and users statistics
- 30-day play history chart
- Top users by watch time
- Most watched content
- Current streaming sessions

### Current Activity
- Real-time view of active playback sessions
- Progress tracking with visual indicators
- Playback state (playing/paused/buffering)
- User information and timestamps
- Auto-refresh every 3 seconds

### Watch History
- Complete history of all playback sessions
- Advanced search functionality (title, show, username)
- Multi-filter system (user, server, media type)
- Flexible pagination (25, 50, 100, 250 items per page)
- Sortable columns (all 7 columns)
- Media thumbnails and metadata
- Completion percentage tracking
- Server identification with logos

### User Statistics
- Individual user profiles
- Total plays and watch time
- Watch distribution by media type
- Recent watches
- Most watched content
- Activity timeline

## API Endpoints

### Activity
- `GET /api/activity` - Get current active sessions

### History
- `GET /api/history` - Get watch history (supports pagination and user filtering)

### Users
- `GET /api/users` - Get all users
- `GET /api/users/:userId/stats` - Get detailed user statistics

### Statistics
- `GET /api/stats/dashboard` - Get dashboard statistics

### Media Servers
- `GET /api/emby/test` - Test Emby connection
- `GET /api/emby/libraries` - Get Emby libraries
- `GET /api/media/recent` - Get recently added media from all servers

### WebSocket
- `ws://localhost:3001/ws` - Real-time activity updates

## Future Plans

### Additional Features
- [ ] Jellyfin support
- [ ] Notifications (Discord, Email, etc.)
- [ ] Custom dashboard widgets
- [ ] Export statistics to CSV/JSON
- [ ] Mobile-responsive design improvements
- [ ] Dark/Light theme toggle
- [ ] User authentication
- [ ] Date range filtering for history

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Acknowledgments

- Inspired by [Tautulli](https://tautulli.com/) - the excellent monitoring tool for Plex
- Built with modern web technologies and best practices
- Thanks to the Emby community for their excellent API documentation

## Support

If you encounter any issues or have questions:
1. Check the [Issues](../../issues) page
2. Create a new issue with detailed information
3. Include logs from both backend and frontend

## Screenshots

### Dashboard
The main dashboard provides an overview of your media server activity with real-time statistics, charts, and current streaming sessions.

### Current Activity
Monitor live playback sessions with detailed information about what users are watching, playback progress, and streaming state.

### User Statistics
Deep dive into individual user activity with comprehensive statistics, watch patterns, and favorite content.

---

**Happy monitoring!** 🎬📊
