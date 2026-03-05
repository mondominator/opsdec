import axios from 'axios';
import db from '../database/init.js';

const TELEGRAM_API = 'https://api.telegram.org/bot';

function getSetting(key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : '';
  } catch (error) {
    console.error(`Error reading setting ${key}:`, error.message);
    return '';
  }
}

function isEnabled() {
  return (
    getSetting('telegram_enabled') === 'true' &&
    getSetting('telegram_bot_token') !== '' &&
    getSetting('telegram_chat_id') !== ''
  );
}

async function sendMessage(text, { botToken, chatId } = {}) {
  const token = botToken || getSetting('telegram_bot_token');
  const chat = chatId || getSetting('telegram_chat_id');

  if (!token || !chat) return;

  try {
    const response = await axios.post(`${TELEGRAM_API}${token}/sendMessage`, {
      chat_id: chat,
      text,
      parse_mode: 'HTML',
    }, { timeout: 5000 });
    if (!response.data?.ok) {
      console.error(`[Telegram] sendMessage API error: ${JSON.stringify(response.data)}`);
    } else {
      const preview = text.replace(/<[^>]+>/g, '').slice(0, 80);
      console.log(`[Telegram] Message sent: "${preview}${text.length > 80 ? '…' : ''}"`);
    }
  } catch (error) {
    console.error('Telegram sendMessage error:', error.message);
  }
}

async function sendPhoto(photoUrl, caption) {
  const token = getSetting('telegram_bot_token');
  const chat = getSetting('telegram_chat_id');
  if (!token || !chat) return;

  const captionPreview = caption.replace(/<[^>]+>/g, '').slice(0, 80);
  try {
    // Fetch via local image proxy to handle auth headers for media servers
    const proxyUrl = `http://localhost:${process.env.PORT || 3001}/proxy/image?url=${encodeURIComponent(photoUrl)}`;
    const imgResponse = await axios.get(proxyUrl, { responseType: 'arraybuffer', timeout: 10000 });
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('chat_id', chat);
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    form.append('photo', Buffer.from(imgResponse.data), { filename: 'cover.jpg', contentType: imgResponse.headers['content-type'] || 'image/jpeg' });

    const response = await axios.post(`${TELEGRAM_API}${token}/sendPhoto`, form, {
      headers: form.getHeaders(),
      timeout: 15000,
    });
    if (!response.data?.ok) {
      console.error(`[Telegram] sendPhoto API error for "${captionPreview}": ${JSON.stringify(response.data)}`);
    } else {
      console.log(`[Telegram] Photo sent: "${captionPreview}"`);
    }
  } catch (error) {
    console.error(`[Telegram] sendPhoto failed for "${captionPreview}": ${error.message} — falling back to text`);
    await sendMessage(caption);
  }
}

async function testConnection(botToken, chatId) {
  const token = botToken || getSetting('telegram_bot_token');
  const chat = chatId || getSetting('telegram_chat_id');

  if (!token) {
    return { success: false, error: 'Bot token is required' };
  }
  if (!chat) {
    return { success: false, error: 'Chat ID is required' };
  }

  try {
    const response = await axios.get(`${TELEGRAM_API}${token}/getMe`, { timeout: 5000 });
    const botName = response.data.result.first_name || response.data.result.username;

    await axios.post(`${TELEGRAM_API}${token}/sendMessage`, {
      chat_id: chat,
      text: `✅ <b>OpsDec Connected</b>\nBot <b>${botName}</b> is linked to this chat.`,
      parse_mode: 'HTML',
    }, { timeout: 5000 });

    return { success: true, botName };
  } catch (error) {
    const msg = error.response?.data?.description || error.message;
    console.error('Telegram test error:', msg);
    return { success: false, error: msg };
  }
}

function isServerAllowed(serverType, settingKey) {
  const allowed = getSetting(settingKey);
  if (!allowed) return true;
  return new Set(allowed.split(',').map(s => s.trim()).filter(Boolean)).has(serverType);
}

function getServerEmoji(serverType) {
  switch (serverType) {
    case 'sappho': return '🔵';
    case 'emby': return '🟢';
    case 'plex': return '🟠';
    case 'jellyfin': return '🟣';
    case 'audiobookshelf': return '🟤';
    default: return '⚪';
  }
}

function notifyPlaybackStarted(session) {
  if (!isEnabled() || getSetting('telegram_notify_playback_start') !== 'true') return;

  const { username, title, serverType, mediaType } = session;
  if (!isServerAllowed(serverType, 'telegram_playback_start_servers')) return;
  const serverIcon = getServerEmoji(serverType);
  const text = `${serverIcon} · <b>${username}</b> started <b>${title}</b>`;
  sendMessage(text);
}

function notifyPlaybackCompleted(session) {
  if (!isEnabled() || getSetting('telegram_notify_playback_complete') !== 'true') return;

  const { username, title, progressPercent, serverType } = session;
  if (!isServerAllowed(serverType, 'telegram_playback_complete_servers')) return;
  const serverIcon = getServerEmoji(serverType);
  const text = `${serverIcon} · <b>${username}</b> finished <b>${title}</b> (${progressPercent}%)`;
  sendMessage(text);
}

function notifyNewUser(username, serverType) {
  if (!isEnabled() || getSetting('telegram_notify_new_user') !== 'true') return;
  if (!isServerAllowed(serverType, 'telegram_new_user_servers')) return;

  const serverIcon = getServerEmoji(serverType);
  const text = `${serverIcon} · New user: <b>${username}</b>`;
  sendMessage(text);
}

// Buffer for recently added items — waits 5 minutes to batch episodes and let metadata settle
let recentlyAddedBuffer = [];
let recentlyAddedTimer = null;
let metadataRefresher = null;
const RECENTLY_ADDED_DELAY = 5 * 60 * 1000; // 5 minutes

function setMetadataRefresher(fn) {
  metadataRefresher = fn;
}

function notifyRecentlyAdded(items) {
  if (!isEnabled() || getSetting('telegram_notify_recently_added') !== 'true') return;
  if (!items || items.length === 0) return;

  const titles = items.map(i => i.name || 'Unknown').join(', ');
  console.log(`[Telegram] Buffering ${items.length} recently added items: ${titles} (buffer now: ${recentlyAddedBuffer.length + items.length})`);
  recentlyAddedBuffer.push(...items);

  // Reset the timer each time new items arrive
  if (recentlyAddedTimer) clearTimeout(recentlyAddedTimer);
  recentlyAddedTimer = setTimeout(() => flushRecentlyAdded(), RECENTLY_ADDED_DELAY);
}

async function flushRecentlyAdded() {
  let items = recentlyAddedBuffer;
  recentlyAddedBuffer = [];
  recentlyAddedTimer = null;

  const bufferTitles = items.map(i => i.name || 'Unknown').join(', ');
  console.log(`[Telegram] Flushing recently added buffer (${items.length} items): ${bufferTitles}`);

  if (items.length === 0) return;

  // Filter by allowed servers if configured
  items = items.filter(i => isServerAllowed(i.server_type, 'telegram_recently_added_servers'));
  if (items.length === 0) {
    console.log('[Telegram] All items filtered out by server allowlist');
    return;
  }
  console.log(`[Telegram] After server filter: ${items.length} items — ${items.map(i => i.name || 'Unknown').join(', ')}`);

  // Re-fetch metadata from servers — posters/thumbs may not have been ready at detection time
  if (metadataRefresher) {
    try {
      console.log('[Telegram] Re-fetching metadata from servers...');
      const refreshTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
      items = await Promise.race([metadataRefresher(items), refreshTimeout]);
      console.log(`[Telegram] Metadata refresh complete (${items.length} items)`);
    } catch (err) {
      console.error('[Telegram] Metadata refresh failed, using original data:', err.message);
    }
  }

  // Group episodes/tracks by their series/show name, keep standalone items separate
  const groups = new Map();
  const standalone = [];

  for (const item of items) {
    const type = (item.type || '').toLowerCase();
    const isEpisode = type === 'episode' || type === 'series' || type === 'youtube';
    // If it looks like a show (series/episode), group by name
    if (isEpisode && items.filter(i => i.name === item.name).length > 1) {
      // Multiple items with same show name — already deduplicated at show level, skip dupes
      if (!groups.has(item.name)) {
        groups.set(item.name, item);
      }
    } else {
      standalone.push(item);
    }
  }

  // Merge: grouped shows + standalone items
  const toSend = [...groups.values(), ...standalone];

  // Send each as an individual photo message with a small delay between
  const sendTitles = toSend.map(i => i.name || 'Unknown').join(', ');
  console.log(`[Telegram] Sending ${toSend.length} recently added notifications: ${sendTitles}`);
  for (const item of toSend) {
    const serverIcon = getServerEmoji(item.server_type);
    let caption = `${serverIcon} · <b>${item.name}</b>`;
    if (item.year) caption += ` (${item.year})`;
    if (item.rating) caption += `  ·  ⭐ ${item.rating}`;
    if (item.overview) {
      const maxOverview = 500;
      const overview = item.overview.length > maxOverview ? item.overview.slice(0, maxOverview) + '…' : item.overview;
      caption += `\n\n${overview}`;
    }
    if (item.runtime) {
      const hours = Math.floor(item.runtime / 60);
      const mins = item.runtime % 60;
      const runtimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      caption += `\n\n${runtimeStr}`;
    }

    if (item.thumb) {
      await sendPhoto(item.thumb, caption);
    } else {
      await sendMessage(caption);
    }

    // Small delay to avoid Telegram rate limits
    await new Promise(r => setTimeout(r, 500));
  }
}

function notifyServerDown(serverName, serverType, error) {
  if (!isEnabled() || getSetting('telegram_notify_server_down') !== 'true') return;
  if (!isServerAllowed(serverType, 'telegram_server_down_servers')) return;
  const serverIcon = getServerEmoji(serverType);
  const text = `${serverIcon} · <b>${serverName}</b> is unreachable\n${error}`;
  sendMessage(text);
}

function notifyServerRecovered(serverName, serverType) {
  if (!isEnabled() || getSetting('telegram_notify_server_down') !== 'true') return;
  if (!isServerAllowed(serverType, 'telegram_server_down_servers')) return;
  const serverIcon = getServerEmoji(serverType);
  const text = `${serverIcon} · <b>${serverName}</b> is back online`;
  sendMessage(text);
}

export default { isEnabled, sendMessage, testConnection, notifyPlaybackStarted, notifyPlaybackCompleted, notifyNewUser, notifyRecentlyAdded, setMetadataRefresher, notifyServerDown, notifyServerRecovered };
