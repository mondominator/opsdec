import express from 'express';
import cors from 'cors';
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
import { startActivityMonitor, audiobookshelfService } from './services/monitor.js';
import { initializeJobs, setAudiobookshelfService } from './services/jobs.js';
import apiRouter from './routes/api.js';
import authRouter from './routes/auth.js';
import { authenticateToken, isSetupRequired, verifyToken } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Middleware
app.use(cors());
app.use(express.json());

// Auth Routes (unprotected)
app.use('/api/auth', authRouter);

// Protected API Routes
app.use('/api', authenticateToken, apiRouter);

// Image proxy to avoid CORS issues
app.get('/proxy/image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send('Missing url parameter');
    }

    // Check if this URL needs authentication and add auth header if needed
    const headers = {};

    // Check database for servers that require authentication (Audiobookshelf, Sappho)
    try {
      const servers = db.prepare('SELECT * FROM servers WHERE enabled = 1').all();
      for (const server of servers) {
        if (imageUrl.startsWith(server.url)) {
          headers['Authorization'] = `Bearer ${server.api_key}`;
          break;
        }
      }
    } catch (dbError) {
      console.error('Error checking database for server auth:', dbError.message);
    }

    // Create HTTPS agent that allows self-signed certificates
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers,
      httpsAgent,
    });

    res.set('Content-Type', response.headers['content-type']);
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.send(response.data);
  } catch (error) {
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
  // Set the audiobookshelf service reference for repair-covers job
  if (audiobookshelfService) {
    setAudiobookshelfService(audiobookshelfService);
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
