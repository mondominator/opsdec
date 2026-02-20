# Recently Added Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add "Recently Added Shows" and "Recently Added Books" cards to the dashboard, pulling from all configured servers with deduplication by title + year.

**Architecture:** Each service gets a `getRecentlyAdded()` method (Plex/Emby/Jellyfin already have one). A new API endpoint aggregates results from all active services, deduplicates, and returns two arrays. The frontend fetches this alongside existing dashboard stats and renders two new cards between the Popular and Top rows.

**Tech Stack:** Node.js/Express backend, React frontend, Vitest tests, Audiobookshelf API (`/api/libraries/{id}/items?sort=addedAt`), Sappho API (`/api/audiobooks?sort=addedAt`)

---

### Task 1: Add getRecentlyAdded() to AudiobookshelfService

**Files:**
- Modify: `backend/src/services/audiobookshelf.js` (after `getLibraries()` method, ~line 70)

**Step 1: Add the method**

Add after the `getLibraries()` method:

```javascript
async getRecentlyAdded(limit = 20) {
  try {
    const libraries = await this.getLibraries();
    const items = [];

    for (const library of libraries) {
      if (library.type !== 'book') continue;

      const response = await this.client.get(`/api/libraries/${library.id}/items`, {
        params: { sort: 'addedAt', desc: 1, limit },
      });

      const libraryItems = response.data.results || [];
      for (const item of libraryItems) {
        const metadata = item.media?.metadata || {};
        items.push({
          id: item.id,
          name: metadata.title || 'Unknown',
          type: 'audiobook',
          year: metadata.publishedYear ? parseInt(metadata.publishedYear) : null,
          seriesName: metadata.seriesName || (metadata.series?.length > 0 ? metadata.series[0].name : null),
          addedAt: item.addedAt ? new Date(item.addedAt * 1000).toISOString() : null,
          thumb: `${this.baseUrl}/api/items/${item.id}/cover`,
        });
      }
    }

    return items.slice(0, limit);
  } catch (error) {
    console.error('Error fetching Audiobookshelf recently added:', error.message);
    return [];
  }
}
```

**Step 2: Verify lint passes**

Run: `npm run lint`
Expected: 0 errors, 0 warnings

**Step 3: Commit**

```bash
git add backend/src/services/audiobookshelf.js
git commit -m "feat: add getRecentlyAdded() to AudiobookshelfService"
```

---

### Task 2: Add getRecentlyAdded() to SapphoService

**Files:**
- Modify: `backend/src/services/sappho.js` (after `getLibraries()` method, ~line 70)

**Step 1: Add the method**

Add after the `getLibraries()` method:

```javascript
async getRecentlyAdded(limit = 20) {
  try {
    const response = await this.client.get('/api/audiobooks', {
      params: { sort: 'addedAt', desc: true, limit },
    });

    const audiobooks = response.data.audiobooks || response.data || [];
    return audiobooks.slice(0, limit).map(book => ({
      id: book.id?.toString(),
      name: book.title || 'Unknown',
      type: 'audiobook',
      year: book.year || null,
      seriesName: book.series || null,
      addedAt: book.addedAt ? new Date(book.addedAt * 1000).toISOString() : (book.createdAt || null),
      thumb: book.id ? `${this.baseUrl}/api/audiobooks/${book.id}/cover` : null,
    }));
  } catch (error) {
    console.error('Error fetching Sappho recently added:', error.message);
    return [];
  }
}
```

**Step 2: Verify lint passes**

Run: `npm run lint`
Expected: 0 errors, 0 warnings

**Step 3: Commit**

```bash
git add backend/src/services/sappho.js
git commit -m "feat: add getRecentlyAdded() to SapphoService"
```

---

### Task 3: Add recently-added API endpoint

**Files:**
- Modify: `backend/src/routes/api.js` (add new route, import remaining services)

**Step 1: Update imports at top of file**

Line 3 currently imports only some services. Update to include all:

```javascript
import { embyService, plexService, audiobookshelfService, sapphoService, jellyfinService, getServerHealthStatus } from '../services/monitor.js';
```

**Step 2: Add the endpoint**

Add before the helper functions at the bottom of the file (before `function applyUserMapping`):

```javascript
// Get recently added media from all servers
router.get('/stats/recently-added', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    // Collect recently added from all active services in parallel
    const promises = [];

    if (plexService) promises.push(plexService.getRecentlyAdded(limit).then(items => items.map(i => ({ ...i, server_type: 'plex' }))));
    if (embyService) promises.push(embyService.getRecentlyAdded(limit).then(items => items.map(i => ({ ...i, server_type: 'emby' }))));
    if (jellyfinService) promises.push(jellyfinService.getRecentlyAdded(limit).then(items => items.map(i => ({ ...i, server_type: 'jellyfin' }))));
    if (audiobookshelfService) promises.push(audiobookshelfService.getRecentlyAdded(limit).then(items => items.map(i => ({ ...i, server_type: 'audiobookshelf' }))));
    if (sapphoService) promises.push(sapphoService.getRecentlyAdded(limit).then(items => items.map(i => ({ ...i, server_type: 'sappho' }))));

    const results = await Promise.all(promises);
    const allItems = results.flat();

    // Deduplicate by title + year
    const deduped = new Map();
    for (const item of allItems) {
      const key = `${(item.name || '').toLowerCase().trim()}|${item.year || ''}`;
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, { ...item, servers: [item.server_type] });
      } else {
        // Keep earliest addedAt and first available thumb
        if (item.addedAt && (!existing.addedAt || item.addedAt < existing.addedAt)) {
          existing.addedAt = item.addedAt;
        }
        if (!existing.thumb && item.thumb) {
          existing.thumb = item.thumb;
        }
        if (!existing.servers.includes(item.server_type)) {
          existing.servers.push(item.server_type);
        }
      }
    }

    // Split into shows and books, sorted by addedAt descending
    const all = Array.from(deduped.values());
    const sortByAdded = (a, b) => {
      if (!a.addedAt) return 1;
      if (!b.addedAt) return -1;
      return new Date(b.addedAt) - new Date(a.addedAt);
    };

    const showTypes = ['episode', 'show', 'series', 'season', 'movie', 'Movie', 'Episode'];
    const bookTypes = ['audiobook', 'book', 'track', 'podcast'];

    const recentShows = all
      .filter(i => showTypes.includes(i.type))
      .sort(sortByAdded)
      .slice(0, limit);

    const recentBooks = all
      .filter(i => bookTypes.includes(i.type))
      .sort(sortByAdded)
      .slice(0, limit);

    res.json({ success: true, data: { recentShows, recentBooks } });
  } catch (error) {
    console.error('Error fetching recently added:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch recently added media' });
  }
});
```

**Step 3: Verify lint passes**

Run: `npm run lint`
Expected: 0 errors, 0 warnings

**Step 4: Commit**

```bash
git add backend/src/routes/api.js
git commit -m "feat: add /api/stats/recently-added endpoint with deduplication"
```

---

### Task 4: Add frontend API function and Dashboard integration

**Files:**
- Modify: `frontend/src/utils/api.js` (~line 132, after `getDashboardStats`)
- Modify: `frontend/src/pages/Dashboard.jsx`

**Step 1: Add API function**

In `frontend/src/utils/api.js`, add after the `getDashboardStats` export:

```javascript
export const getRecentlyAdded = () => api.get('/stats/recently-added');
```

**Step 2: Update Dashboard imports**

In `frontend/src/pages/Dashboard.jsx`, update the api import at line 3:

```javascript
import { getDashboardStats, getActivity, getWsToken, getRecentlyAdded } from '../utils/api';
```

Add `Clock` to the lucide-react import:

```javascript
import { Users, Headphones, ChevronDown, Book, Play, MapPin, Film, Tv, Clock } from 'lucide-react';
```

**Step 3: Add state and fetch**

Add state after the existing `useState` declarations (~line 74):

```javascript
const [recentlyAdded, setRecentlyAdded] = useState(null);
```

Update `loadData` function to also fetch recently added:

```javascript
const loadData = async () => {
  try {
    const [statsRes, activityRes, recentRes] = await Promise.all([
      getDashboardStats(),
      getActivity(),
      getRecentlyAdded(),
    ]);

    setStats(statsRes.data.data);
    setActivity(activityRes.data.data);
    setRecentlyAdded(recentRes.data.data);
  } catch (error) {
    console.error('Error loading dashboard:', error);
  } finally {
    setLoading(false);
  }
};
```

**Step 4: Add recently added sections between Popular and Top rows**

In the `sections` array, the first 3 items are Popular (shows, movies, books) and the last 3 are Top (watchers, listeners, locations). After the sections array, build the recently added sections:

```javascript
const recentSections = [
  recentlyAdded?.recentShows?.length > 0 && {
    type: 'recent', items: recentlyAdded.recentShows, category: 'recent-shows', count: 5, span: '',
    icon: Tv, label: 'Recently Added Shows', accent: 'border-indigo-400', iconColor: 'text-indigo-400/70',
  },
  recentlyAdded?.recentBooks?.length > 0 && {
    type: 'recent', items: recentlyAdded.recentBooks, category: 'recent-books', count: 5, span: '',
    icon: Book, label: 'Recently Added Books', accent: 'border-orange-400', iconColor: 'text-orange-400/70', bookMode: true,
  },
].filter(Boolean);
```

**Step 5: Add renderRecentRows function**

Add after `renderLocationRows`:

```javascript
const renderRecentRows = (section) =>
  section.items.slice(0, section.count).map((item, index) => (
    <div
      key={index}
      className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/[0.03] transition-colors"
    >
      <span className="flex-shrink-0 w-4 text-center text-gray-600 text-[11px] font-mono">{index + 1}</span>
      <div className="flex-shrink-0 w-7 h-10 rounded overflow-hidden bg-dark-700">
        <MediaThumbnail
          src={item.thumb}
          alt={item.name}
          title={item.name}
          serverType={section.bookMode ? 'audiobookshelf' : item.server_type}
          className="w-full h-full"
          iconSize="w-3 h-3"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white text-[13px] truncate" title={item.name}>{item.name}</div>
        {item.seriesName && (
          <div className="text-[11px] text-gray-500 truncate">{item.seriesName}</div>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {item.servers?.map(s => (
          <span key={s}>{getServerIcon(s, 'w-3 h-3')}</span>
        ))}
      </div>
    </div>
  ));
```

**Step 6: Update renderSection to handle 'recent' type**

In the `renderSection` function, add the recent type handler:

```javascript
{section.type === 'recent' && renderRecentRows(section)}
```

**Step 7: Update the JSX to render three grid rows**

Replace the single grid with three grids (Popular, Recently Added, Top):

```jsx
{/* Popular media grid */}
{sections.filter((_, i) => i < 3).length > 0 && (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 items-start">
    {sections.filter((_, i) => i < 3).map(renderSection)}
  </div>
)}

{/* Recently added grid */}
{recentSections.length > 0 && (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 items-start">
    {recentSections.map(renderSection)}
  </div>
)}

{/* Top users/locations grid */}
{sections.filter((_, i) => i >= 3).length > 0 && (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 items-start">
    {sections.filter((_, i) => i >= 3).map(renderSection)}
  </div>
)}
```

**Step 8: Verify lint passes and app builds**

Run: `npm run lint`
Expected: 0 errors, 0 warnings

Run: `npm run build`
Expected: Build succeeds

**Step 9: Commit**

```bash
git add frontend/src/utils/api.js frontend/src/pages/Dashboard.jsx
git commit -m "feat: add recently added shows and books cards to dashboard"
```

---

### Task 5: Run all checks and verify

**Step 1: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors, 0 warnings

**Step 3: Run security audit**

Run: `npm run audit:check`
Expected: No high/critical vulnerabilities

**Step 4: Manual smoke test**

Run: `npm run dev`
Verify:
- Dashboard loads without errors
- Recently Added Shows card appears between Popular and Top rows (if servers have data)
- Recently Added Books card appears (if book servers are configured)
- Items are deduplicated (same title+year from multiple servers shows once with multiple server icons)
- Cover art thumbnails load correctly
- No console errors
