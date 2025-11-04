# OpsDec - Quick Start Guide

Get up and running with OpsDec in just a few minutes!

## Prerequisites

- Node.js 18+ installed
- At least one media server with API access:
  - Plex Media Server, or
  - Emby Media Server, or
  - Audiobookshelf

## Quick Setup

### Option 1: Automated Setup (Recommended)

```bash
# Run the setup script
./setup.sh

# Edit your server credentials
nano backend/.env

# Start the application
npm run dev
```

### Option 2: Manual Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp backend/.env.example backend/.env
nano backend/.env  # Edit with your settings

# 3. Create data directory
mkdir -p backend/data

# 4. Start the application
npm run dev
```

## Getting Your API Keys/Tokens

### Plex Token

1. Sign in to Plex Web App
2. Open any media item
3. Click the three dots (•••) → "Get Info"
4. Click "View XML"
5. In the URL, find `X-Plex-Token=xxxxx` - that's your token
6. Paste it into `backend/.env` as `PLEX_TOKEN`

### Emby API Key

1. Open your Emby web interface
2. Navigate to: **Dashboard** → **Advanced** → **Security** → **API Keys**
3. Click **New API Key** (the + button)
4. Name: `OpsDec`
5. Copy the generated key
6. Paste it into `backend/.env` as `EMBY_API_KEY`

### Audiobookshelf Token

1. Log into your Audiobookshelf server
2. Click on your profile icon (top right)
3. Go to **Settings** → **Account**
4. Click **Generate New API Token**
5. Copy the generated token
6. Paste it into `backend/.env` as `AUDIOBOOKSHELF_TOKEN`

## Configuration

Edit `backend/.env` and configure at least one media server:

```env
# Plex Configuration (optional - leave blank if not using)
PLEX_URL=http://192.168.1.100:32400
PLEX_TOKEN=your_plex_token_here

# Emby Configuration (optional - leave blank if not using)
EMBY_URL=http://192.168.1.101:8096
EMBY_API_KEY=your_emby_api_key_here

# Audiobookshelf Configuration (optional - leave blank if not using)
AUDIOBOOKSHELF_URL=http://192.168.1.102:13378
AUDIOBOOKSHELF_TOKEN=your_audiobookshelf_token_here

# How often to check for activity (in seconds)
POLL_INTERVAL=30
```

## Starting the Application

### Development Mode
```bash
npm run dev
```

This starts:
- Backend API: http://localhost:3001
- Frontend UI: http://localhost:3000

The frontend will automatically proxy API requests to the backend.

### Production Mode
```bash
# Build the frontend
npm run build

# Start the backend
npm start
```

Then configure your web server (Nginx, Apache, etc.) to serve the frontend and proxy API requests.

## Verifying Everything Works

1. Open http://localhost:3000 in your browser
2. You should see the OpsDec dashboard
3. Start playing something on any of your configured media servers
4. Within 30 seconds (or your POLL_INTERVAL), you should see it appear in the "Currently Streaming" section

## Troubleshooting

### "No Active Streams" showing on dashboard

**Possible causes:**
- No media servers are configured correctly in `.env`
- No one is currently watching/listening to anything
- The POLL_INTERVAL hasn't elapsed yet (wait 30 seconds)

**Solution:**
```bash
# Test your Emby connection (if configured)
curl http://localhost:3001/api/emby/test

# Check backend logs
npm run dev:backend
```

### Backend won't start

**Check:**
1. Port 3001 is not in use: `lsof -i :3001`
2. `.env` file exists: `ls -la backend/.env`
3. Dependencies are installed: `npm install`

### Frontend won't load

**Check:**
1. Port 3000 is not in use: `lsof -i :3000`
2. Backend is running on port 3001
3. Try clearing browser cache

### Database errors

**Solution:**
```bash
# Remove and recreate the database
rm -f backend/data/opsdec.db
# Restart the backend - it will recreate the database
npm run dev:backend
```

## Default Credentials

OpsDec doesn't require authentication by default. For production deployments, consider:
- Running behind a reverse proxy with authentication
- Restricting access via firewall rules
- Only exposing on localhost/internal network

## Next Steps

- Explore the **Dashboard** for an overview
- Check **Current Activity** to see live streams
- View **History** for past playback sessions
- Click on **Users** to see individual statistics

## Need Help?

- Check the full [README.md](README.md)
- Review the [API documentation](README.md#api-endpoints)
- Open an issue on GitHub

---

Enjoy tracking your media server! 🎬📊
