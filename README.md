# OpsDec

> [!WARNING]
> **Early Development** - Functional but expect rough edges. Feedback and contributions welcome.

Self-hosted media server monitoring and statistics platform. Aggregates activity from Plex, Emby, Audiobookshelf, and Sappho into a single dashboard with real-time session tracking, watch history, and per-user analytics.

![OpsDec](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
[![Docker Image](https://ghcr-badge.egpl.dev/mondominator/opsdec/latest_tag?trim=major&label=latest)](https://github.com/mondominator/opsdec/pkgs/container/opsdec)

## Key Capabilities

- **Multi-server aggregation** - Monitor Plex, Emby, Audiobookshelf, and Sappho from one interface
- **Real-time sessions** - Live playback tracking via WebSocket with progress, state, and geolocation
- **User mapping** - Unify identities across servers (e.g., "john" on Plex and "john.doe" on Emby become one user)
- **History filtering** - Configurable minimum duration, progress thresholds, and title exclusion patterns
- **Mobile-optimized** - Fully responsive with touch-friendly controls

## Quick Start

### Docker Compose (Recommended)

```yaml
services:
  opsdec:
    image: ghcr.io/mondominator/opsdec:latest
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/backend/data
    environment:
      # Configure the servers you use (all optional)
      - PLEX_URL=http://your-plex-server:32400
      - PLEX_TOKEN=your_plex_token
      - EMBY_URL=http://your-emby-server:8096
      - EMBY_API_KEY=your_emby_api_key
      - AUDIOBOOKSHELF_URL=http://your-abs-server:13378
      - AUDIOBOOKSHELF_TOKEN=your_abs_token
      - SAPPHO_URL=http://your-sappho-server:3000
      - SAPPHO_API_KEY=your_sappho_api_key
      - POLL_INTERVAL=30
```

```bash
docker-compose up -d
```

Access at `http://localhost:3001`. First visit prompts account creation.

### Unraid

Install via Community Applications (search "OpsDec") or manually add the [template XML](https://raw.githubusercontent.com/mondominator/opsdec/main/opsdec-unraid-template.xml) to `/boot/config/plugins/dockerMan/templates-user/`.

### Manual

Requires Node.js >= 18.

```bash
git clone https://github.com/mondominator/opsdec.git
cd opsdec
npm install
cp backend/.env.example backend/.env  # edit with your server details
npm run dev
```

Backend runs on `:3001`, frontend dev server on `:3000`.

## Image Tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest main branch build |
| `YYYYMMDD` | Date-pinned (e.g., `20251118`) |
| `main-abc1234` | Commit SHA |
| `x.y.z` | Semantic version (when tagged) |

Use date-based or version tags in production for stability.

## Server Configuration

Servers can be configured two ways (both work simultaneously):

**Environment variables** - Set `*_URL` and `*_TOKEN`/`*_API_KEY` pairs. These appear as read-only in the Settings UI.

**Settings UI** - Add, edit, and remove servers from the web interface. Navigate to Settings and click Add Server.

### Obtaining API Keys

| Server | Where to find it |
|--------|-----------------|
| **Plex** | Plex Web App > any media item > ... > Get Info > View XML > `X-Plex-Token` in URL |
| **Emby** | Settings > Advanced > API Keys > New API Key |
| **Audiobookshelf** | Profile > Settings > Account > Generate New API Token |
| **Sappho** | Settings > API Keys > Create New API Key |

## Development

```bash
npm run dev              # Run backend + frontend with hot reload
npm run build            # Production build
npm start                # Start production server
npm test                 # Run all tests (136 total)
npm run test:backend     # Backend tests only (95 tests)
npm run test:frontend    # Frontend tests only (41 tests)
npm run test:coverage    # Tests with coverage report
```

### Tech Stack

| Layer | Stack |
|-------|-------|
| Backend | Node.js, Express, SQLite (better-sqlite3), WebSocket |
| Frontend | React 18, Vite, TailwindCSS, Recharts |
| Testing | Vitest, React Testing Library |
| Deployment | Docker, GitHub Container Registry |

## Roadmap

- Jellyfin support
- Notifications (Discord, email, webhooks)
- Export statistics (CSV/JSON)
- Date range filtering for history
- Light theme

## Contributing

Pull requests welcome. Please open an issue first for significant changes.

## License

MIT
