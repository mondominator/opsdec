# OpsDec

> [!WARNING]
> **Early Development** - Functional but expect rough edges. Feedback and contributions welcome.

Self-hosted media server monitoring platform. Tracks activity from Plex, Emby, Jellyfin, Audiobookshelf, and Sappho with real-time session tracking, watch history, and per-user analytics. Integrates with Overseerr/Jellyseerr for request management.

![OpsDec](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
[![Docker Image](https://ghcr-badge.egpl.dev/mondominator/opsdec/latest_tag?trim=major&label=latest)](https://github.com/mondominator/opsdec/pkgs/container/opsdec)

## Quick Start

### Docker Compose

```yaml
services:
  opsdec:
    image: ghcr.io/mondominator/opsdec:latest
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/backend/data
    environment:
      # Add the servers you use (all optional — can also configure via UI)
      - PLEX_URL=http://plex:32400
      - PLEX_TOKEN=your_token
      - EMBY_URL=http://emby:8096
      - EMBY_API_KEY=your_key
      - JELLYFIN_URL=http://jellyfin:8096
      - JELLYFIN_API_KEY=your_key
      - AUDIOBOOKSHELF_URL=http://abs:13378
      - AUDIOBOOKSHELF_TOKEN=your_token
      - SAPPHO_URL=http://sappho:3000
      - SAPPHO_API_KEY=your_key
```

```bash
docker-compose up -d
```

Access at `http://localhost:3001`. First visit prompts account creation.

### Unraid

Install via Community Applications (search "OpsDec") or manually add the [template XML](https://raw.githubusercontent.com/mondominator/opsdec/main/opsdec-unraid-template.xml).

### Manual

Requires Node.js >= 18.

```bash
git clone https://github.com/mondominator/opsdec.git
cd opsdec && npm install
cp backend/.env.example backend/.env  # edit with your server details
npm run dev
```

## Supported Servers

| Server | Monitoring | Notes |
|--------|-----------|-------|
| **Plex** | Sessions, history | WebSocket + polling |
| **Emby** | Sessions, history | WebSocket + polling |
| **Jellyfin** | Sessions, history | WebSocket + polling |
| **Audiobookshelf** | Sessions, history | Polling + history import |
| **Sappho** | Sessions, history | WebSocket-based |
| **Overseerr / Jellyseerr** | Recently added, health | Periodic polling |

## Notifications

Telegram notifications for:
- Playback start/complete
- Recently added media (batched with posters)
- Server up/down alerts
- New user detection

Configure in Settings > Notifications.

## Server Configuration

**Environment variables** — Set `*_URL` and `*_TOKEN`/`*_API_KEY` pairs. Appear read-only in Settings.

**Settings UI** — Add, edit, and remove servers from the web interface.

### API Keys

| Server | Where to find it |
|--------|-----------------|
| **Plex** | Plex Web > media item > ... > Get Info > View XML > `X-Plex-Token` in URL |
| **Emby** | Settings > Advanced > API Keys > New API Key |
| **Jellyfin** | Dashboard > Advanced > API Keys |
| **Audiobookshelf** | Profile > Settings > Account > Generate New API Token |
| **Sappho** | Settings > API Keys > Create New API Key |
| **Overseerr** | Settings > General > API Key |

## Image Tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest main branch build |
| `YYYYMMDD` | Date-pinned (e.g., `20251118`) |
| `main-abc1234` | Commit SHA |
| `x.y.z` | Semantic version (when tagged) |

## Development

```bash
npm run dev       # Backend (3001) + frontend (3000) with hot reload
npm run build     # Production build
npm test          # Run all tests
```

**Stack:** Node.js/Express, React 18/Vite/TailwindCSS, SQLite, WebSocket

## Contributing

Pull requests welcome. Please open an issue first for significant changes.

## License

MIT
