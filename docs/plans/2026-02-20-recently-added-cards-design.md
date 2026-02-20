# Recently Added Cards — Design

## Overview

Add two new dashboard cards showing recently added shows and books, with deduplication across servers.

## Backend

### New service methods

Add `getRecentlyAdded(limit)` to AudiobookshelfService and SapphoService. Plex, Emby, and Jellyfin already have this method.

Each method returns items in a common format:
- `id`, `name`, `type`, `year`, `seriesName`, `addedAt`, `thumb`

### New API endpoint

`GET /api/stats/recently-added`

Calls `getRecentlyAdded()` on all active servers, deduplicates, and returns:
```json
{
  "recentShows": [...],
  "recentBooks": [...]
}
```

### Deduplication

Key: `lowercase(title) + year`. When a duplicate is found across servers:
- Keep the earliest `addedAt`
- Prefer whichever thumbnail is available first
- Track which servers have the item (for server icon display)

### Caching

Cache results in memory with a 5-minute TTL. Library additions are infrequent; no need to hit all servers on every dashboard load.

## Frontend

### Data fetching

Fetch from `/api/stats/recently-added` in `Dashboard.jsx` alongside the existing `getDashboardStats()` call.

### Cards

Two new section cards in the same numbered-list-row style as existing Popular cards:
- "Recently Added Shows" — title, series name (if episode), cover art, "added X ago" timestamp
- "Recently Added Books" — same format for audiobooks

### Placement

Between the Popular row (Shows, Movies, Books) and the Top row (Watchers, Listeners, Locations).

### Grid

Same 3-column grid. The two recently added cards sit in their own row.
