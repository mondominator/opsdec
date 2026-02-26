import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { parse as parseUrl } from 'url';
import { initDatabase, db } from './database/init.js';
import { startActivityMonitor, audiobookshelfService, plexService, embyService, jellyfinService, sapphoService } from './services/monitor.js';
import { initializeJobs, setAudiobookshelfService, setPlexService, setEmbyService, setJellyfinService, setSapphoService } from './services/jobs.js';
import apiRouter from './routes/api.js';
import authRouter from './routes/auth.js';
import { authenticateToken, verifyToken } from './middleware/auth.js';
import { decrypt } from './utils/crypto.js';
import imageCache from './services/imageCache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Trust proxy for correct client IP detection behind reverse proxies
// This is needed for rate limiting to work correctly
app.set('trust proxy', 1);

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind requires inline styles
      imgSrc: ["'self'", "data:", "blob:", "https:"], // Allow external images for avatars/covers
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: null, // Don't force HTTPS — breaks local/HTTP deployments
    },
  },
  crossOriginEmbedderPolicy: false, // Required for loading external images
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow image proxy to work
}));

// CORS configuration with credentials support
app.use(cors({
  origin: IS_PRODUCTION ? true : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
}));

// Body parsing and cookies
app.use(express.json());
app.use(cookieParser());

// Auth Routes (unprotected)
app.use('/api/auth', authRouter);

// Protected API Routes
app.use('/api', authenticateToken, apiRouter);

// Image proxy to avoid CORS issues - validates URL against configured servers to prevent SSRF
app.get('/proxy/image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send('Missing url parameter');
    }

    // Validate URL format
    let parsedUrl;
    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      return res.status(400).send('Invalid URL format');
    }

    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).send('Invalid URL protocol');
    }

    // Check disk cache before doing SSRF validation or upstream fetch
    const cached = imageCache.get(imageUrl);
    if (cached) {
      res.set('Content-Type', cached.contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('X-Cache', 'HIT');
      return res.send(cached.data);
    }

    // Whitelist of trusted domains for user avatars (not internal network accessible)
    const trustedAvatarDomains = [
      'plex.tv',
      'gravatar.com',
      'secure.gravatar.com',
      'www.gravatar.com',
      'i.imgur.com',
      'image.tmdb.org',  // TMDB images
      'artworks.thetvdb.com',  // TVDB images
    ];

    // Check if URL matches a configured server or trusted avatar domain (SSRF protection)
    const headers = {};
    let isAllowedUrl = false;

    // Check trusted avatar domains first (no auth needed)
    if (trustedAvatarDomains.some(domain => parsedUrl.hostname === domain || parsedUrl.hostname.endsWith('.' + domain))) {
      isAllowedUrl = true;
    }

    // Check configured media servers
    if (!isAllowedUrl) {
      try {
        const servers = db.prepare('SELECT * FROM servers WHERE enabled = 1').all();
        for (const server of servers) {
          if (imageUrl.startsWith(server.url)) {
            isAllowedUrl = true;
            // Decrypt API key before using for authorization
            const apiKey = decrypt(server.api_key);
            headers['Authorization'] = `Bearer ${apiKey}`;
            break;
          }
        }
      } catch (dbError) {
        console.error('Error checking database for server auth:', dbError.message);
      }
    }

    // Block requests to non-configured servers (SSRF protection)
    if (!isAllowedUrl) {
      return res.status(403).send('URL not allowed - must match a configured media server or trusted domain');
    }

    // Create HTTPS agent that allows self-signed certificates (for local media servers)
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers,
      httpsAgent,
    });

    const contentType = response.headers['content-type'];

    // Cache the successfully fetched image to disk
    imageCache.put(imageUrl, Buffer.from(response.data), contentType);

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'MISS');
    res.send(response.data);
  } catch (error) {
    // Upstream fetch failed — try serving stale cache as fallback
    const stale = imageCache.get(req.query.url);
    if (stale) {
      res.set('Content-Type', stale.contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('X-Cache', 'STALE');
      return res.send(stale.data);
    }

    console.error('Error proxying image:', error.message);
    res.status(500).send('Error fetching image');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'OpsDec' });
});

// Serve frontend in production
if (IS_PRODUCTION) {
  const frontendPath = join(__dirname, '../../frontend/dist');

  if (existsSync(frontendPath)) {
    app.use(express.static(frontendPath, {
      maxAge: 0, // Disable caching for now to force reload
      etag: false
    }));

    app.get('*', (req, res) => {
      res.sendFile(join(frontendPath, 'index.html'));
    });

    console.log('📦 Serving frontend from', frontendPath);
  } else {
    console.warn('⚠️  Frontend build not found. Run `npm run build` first.');
  }
}

// Create HTTP server
const server = http.createServer(app);

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // Parse token from query string
  const url = parseUrl(req.url, true);
  const token = url.query.token;

  // Verify token
  if (!token) {
    console.log('WebSocket connection rejected: no token');
    ws.close(4001, 'Authentication required');
    return;
  }

  const user = verifyToken(token);
  if (!user) {
    console.log('WebSocket connection rejected: invalid token');
    ws.close(4003, 'Invalid token');
    return;
  }

  // Attach user to websocket for reference
  ws.user = user;
  console.log(`WebSocket client connected: ${user.username}`);

  ws.on('close', () => {
    console.log(`WebSocket client disconnected: ${user.username}`);
  });
});

// Broadcast function for WebSocket updates
export const broadcast = (data) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN state
      client.send(JSON.stringify(data));
    }
  });
};

// Initialize database and start server
initDatabase();

server.listen(PORT, () => {
  console.log(`🚀 OpsDec backend running on http://localhost:${PORT}`);
  console.log(`📊 WebSocket server running on ws://localhost:${PORT}/ws`);

  // Start activity monitoring
  startActivityMonitor();

  // Initialize scheduled jobs
  // Set service references for repair-covers job
  if (audiobookshelfService) {
    setAudiobookshelfService(audiobookshelfService);
  }
  if (plexService) {
    setPlexService(plexService);
  }
  if (embyService) {
    setEmbyService(embyService);
  }
  if (jellyfinService) {
    setJellyfinService(jellyfinService);
  }
  if (sapphoService) {
    setSapphoService(sapphoService);
  }
  initializeJobs();
});

// Graceful shutdown handler to ensure database is properly closed
function gracefulShutdown(signal) {
  console.log(`\n${signal} received, starting graceful shutdown...`);

  // Import db here to ensure it's available
  import('./database/init.js').then(({ db }) => {
    // Checkpoint and close database to ensure all WAL data is persisted
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      console.log('✅ Database closed successfully');
    } catch (error) {
      console.error('Error closing database:', error);
    }

    // Close the server
    server.close(() => {
      console.log('✅ Server closed successfully');
      process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
      console.error('⚠️  Forcing shutdown after timeout');
      process.exit(1);
    }, 10000);
  });
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
