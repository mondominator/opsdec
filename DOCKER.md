# OpsDec - Docker Deployment Guide

Complete guide for deploying OpsDec using Docker.

## Quick Start with Docker Compose

1. **Create a docker-compose.yml file:**

```yaml
version: '3.8'

services:
  opsdec:
    image: opsdec:latest  # Or build from source
    container_name: opsdec
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/backend/data
    environment:
      # NODE_ENV is already set to production by default in Dockerfile
      - PORT=3001
      - DB_PATH=/app/backend/data/opsdec.db
      # Plex Configuration (optional)
      - PLEX_URL=http://192.168.1.100:32400
      - PLEX_TOKEN=your_plex_token_here
      # Emby Configuration (optional)
      - EMBY_URL=http://192.168.1.101:8096
      - EMBY_API_KEY=your_emby_api_key_here
      # Audiobookshelf Configuration (optional)
      - AUDIOBOOKSHELF_URL=http://192.168.1.102:13378
      - AUDIOBOOKSHELF_TOKEN=your_audiobookshelf_token_here
      # Polling
      - POLL_INTERVAL=30
```

2. **Start the container:**

```bash
docker-compose up -d
```

3. **View logs:**

```bash
docker-compose logs -f
```

4. **Access the UI:**

Open http://localhost:3001 in your browser

## Building from Source

### Clone and Build

```bash
git clone <repository-url>
cd opsdec
docker build -t opsdec:latest .
```

### Run

```bash
docker run -d \
  --name opsdec \
  --restart unless-stopped \
  -p 3001:3001 \
  -v $(pwd)/data:/app/backend/data \
  -e PLEX_URL=http://your-plex:32400 \
  -e PLEX_TOKEN=your_plex_token \
  -e EMBY_URL=http://your-emby:8096 \
  -e EMBY_API_KEY=your_emby_key \
  -e AUDIOBOOKSHELF_URL=http://your-audiobookshelf:13378 \
  -e AUDIOBOOKSHELF_TOKEN=your_abs_token \
  opsdec:latest
```

## Environment Variables

### Required

- `PORT` - Port to run the server on (default: 3001)
- `DB_PATH` - Path to SQLite database file

**Note:** `NODE_ENV` is automatically set to `production` in the Docker image.

### Optional - Plex

- `PLEX_URL` - URL to your Plex server (e.g., http://192.168.1.100:32400)
- `PLEX_TOKEN` - Your Plex authentication token

### Optional - Emby

- `EMBY_URL` - URL to your Emby server (e.g., http://192.168.1.101:8096)
- `EMBY_API_KEY` - Your Emby API key

### Optional - Audiobookshelf

- `AUDIOBOOKSHELF_URL` - URL to your Audiobookshelf server (e.g., http://192.168.1.102:13378)
- `AUDIOBOOKSHELF_TOKEN` - Your Audiobookshelf API token

### Optional - Configuration

- `POLL_INTERVAL` - How often to check for activity in seconds (default: 30)

## Docker Network Configuration

### Connecting to Media Servers on Host

If your media servers are running on the host machine:

**Linux:**
```yaml
environment:
  - PLEX_URL=http://172.17.0.1:32400
```

**macOS/Windows (Docker Desktop):**
```yaml
environment:
  - PLEX_URL=http://host.docker.internal:32400
```

### Connecting to Media Servers in Other Containers

If your media servers are in Docker containers on the same network:

```yaml
version: '3.8'

services:
  plex:
    image: plexinc/pms-docker
    container_name: plex
    networks:
      - media

  opsdec:
    image: opsdec:latest
    container_name: opsdec
    environment:
      - PLEX_URL=http://plex:32400
      - PLEX_TOKEN=your_token
    networks:
      - media

networks:
  media:
    name: media
```

## Volume Mounts

### Database Persistence

**Required:** Mount a volume to persist the database:

```yaml
volumes:
  - ./data:/app/backend/data
```

Or use a named volume:

```yaml
volumes:
  - opsdec-data:/app/backend/data

volumes:
  opsdec-data:
```

### Configuration File (Optional)

You can mount a .env file instead of using environment variables:

```yaml
volumes:
  - ./backend/.env:/app/backend/.env:ro
```

## Docker Compose Examples

### Plex Only

```yaml
version: '3.8'

services:
  opsdec:
    image: opsdec:latest
    container_name: opsdec
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/backend/data
    environment:
      - PLEX_URL=http://192.168.1.100:32400
      - PLEX_TOKEN=your_plex_token
      - POLL_INTERVAL=30
```

### Emby Only

```yaml
version: '3.8'

services:
  opsdec:
    image: opsdec:latest
    container_name: opsdec
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/backend/data
    environment:
      - EMBY_URL=http://192.168.1.101:8096
      - EMBY_API_KEY=your_emby_api_key
      - POLL_INTERVAL=30
```

### All Three Servers (Plex, Emby, and Audiobookshelf)

```yaml
version: '3.8'

services:
  opsdec:
    image: opsdec:latest
    container_name: opsdec
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/backend/data
    environment:
      # Plex
      - PLEX_URL=http://192.168.1.100:32400
      - PLEX_TOKEN=your_plex_token
      # Emby
      - EMBY_URL=http://192.168.1.101:8096
      - EMBY_API_KEY=your_emby_api_key
      # Audiobookshelf
      - AUDIOBOOKSHELF_URL=http://192.168.1.102:13378
      - AUDIOBOOKSHELF_TOKEN=your_audiobookshelf_token
      # Config
      - POLL_INTERVAL=30
```

## Reverse Proxy Configuration

### Nginx

```nginx
server {
    listen 80;
    server_name opsdec.example.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:3001/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

### Traefik

```yaml
version: '3.8'

services:
  opsdec:
    image: opsdec:latest
    container_name: opsdec
    restart: unless-stopped
    volumes:
      - ./data:/app/backend/data
    environment:
      - PLEX_URL=http://plex:32400
      - PLEX_TOKEN=your_token
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.opsdec.rule=Host(`opsdec.example.com`)"
      - "traefik.http.routers.opsdec.entrypoints=web"
      - "traefik.http.services.opsdec.loadbalancer.server.port=3001"
    networks:
      - traefik

networks:
  traefik:
    external: true
```

## Troubleshooting

### Container won't start

Check logs:
```bash
docker logs opsdec
```

### Can't connect to media server

1. Verify the URL is accessible from inside the container:
```bash
docker exec opsdec wget -O- http://your-server:port
```

2. Check network connectivity:
```bash
docker exec opsdec ping your-server-hostname
```

3. For host-based servers, use `host.docker.internal` (Docker Desktop) or `172.17.0.1` (Linux)

### Database errors

Remove and recreate the database:
```bash
docker-compose down
rm -rf data/
docker-compose up -d
```

### Permission issues

Ensure the data directory has correct permissions:
```bash
chown -R 1000:1000 ./data
```

## Health Check

The container includes a health check. View status:

```bash
docker inspect --format='{{.State.Health.Status}}' opsdec
```

Manual health check:
```bash
curl http://localhost:3001/health
```

Expected response:
```json
{"status":"ok","service":"OpsDec"}
```

## Updating

### Pull latest image

```bash
docker-compose pull
docker-compose up -d
```

### Rebuild from source

```bash
git pull
docker-compose build --no-cache
docker-compose up -d
```

## Backup

### Backup database

```bash
docker-compose exec opsdec sqlite3 /app/backend/data/opsdec.db .dump > backup.sql
```

Or simply copy the database file:
```bash
cp data/opsdec.db data/opsdec.db.backup
```

### Restore database

```bash
docker-compose down
cp data/opsdec.db.backup data/opsdec.db
docker-compose up -d
```

---

For more information, see the main [README.md](README.md)
