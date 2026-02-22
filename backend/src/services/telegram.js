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
    await axios.post(`${TELEGRAM_API}${token}/sendMessage`, {
      chat_id: chat,
      text,
      parse_mode: 'HTML',
    }, { timeout: 5000 });
  } catch (error) {
    console.error('Telegram sendMessage error:', error.message);
  }
}

async function sendPhoto(photoUrl, caption) {
  const token = getSetting('telegram_bot_token');
  const chat = getSetting('telegram_chat_id');
  if (!token || !chat) return;

  try {
    // Download image from media server (local network) and upload to Telegram
    const imgResponse = await axios.get(photoUrl, { responseType: 'arraybuffer', timeout: 10000 });
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('chat_id', chat);
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    form.append('photo', Buffer.from(imgResponse.data), { filename: 'cover.jpg', contentType: imgResponse.headers['content-type'] || 'image/jpeg' });

    await axios.post(`${TELEGRAM_API}${token}/sendPhoto`, form, {
      headers: form.getHeaders(),
      timeout: 15000,
    });
  } catch {
    // If photo fails, fall back to text-only message
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

function notifyPlaybackStarted(session) {
  if (!isEnabled() || getSetting('telegram_notify_playback_start') !== 'true') return;

  const { username, title, serverType, mediaType } = session;
  const icon = mediaType === 'audio' || mediaType === 'audiobook' ? '🎧' : '▶️';
  const text = `${icon} <b>${username}</b> started <b>${title}</b> on ${serverType}`;
  sendMessage(text);
}

function notifyPlaybackCompleted(session) {
  if (!isEnabled() || getSetting('telegram_notify_playback_complete') !== 'true') return;

  const { username, title, progressPercent, serverType } = session;
  const text = `✅ <b>${username}</b> finished <b>${title}</b> (${progressPercent}%) on ${serverType}`;
  sendMessage(text);
}

function notifyNewUser(username, serverType) {
  if (!isEnabled() || getSetting('telegram_notify_new_user') !== 'true') return;

  const text = `👤 New user: <b>${username}</b> on ${serverType}`;
  sendMessage(text);
}

// Buffer for recently added items — waits 2 minutes to batch episodes of the same show
let recentlyAddedBuffer = [];
let recentlyAddedTimer = null;
const RECENTLY_ADDED_DELAY = 2 * 60 * 1000; // 2 minutes

function notifyRecentlyAdded(items) {
  if (!isEnabled() || getSetting('telegram_notify_recently_added') !== 'true') return;
  if (!items || items.length === 0) return;

  recentlyAddedBuffer.push(...items);

  // Reset the timer each time new items arrive
  if (recentlyAddedTimer) clearTimeout(recentlyAddedTimer);
  recentlyAddedTimer = setTimeout(() => flushRecentlyAdded(), RECENTLY_ADDED_DELAY);
}

async function flushRecentlyAdded() {
  let items = recentlyAddedBuffer;
  recentlyAddedBuffer = [];
  recentlyAddedTimer = null;

  if (items.length === 0) return;

  // Filter by allowed servers if configured
  const allowedServers = getSetting('telegram_recently_added_servers');
  if (allowedServers) {
    const allowed = new Set(allowedServers.split(',').map(s => s.trim()).filter(Boolean));
    items = items.filter(i => allowed.has(i.server_type));
    if (items.length === 0) return;
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
  for (const item of toSend) {
    const caption = `<b>${item.name}</b>`;

    if (item.thumb) {
      await sendPhoto(item.thumb, caption);
    } else {
      await sendMessage(caption);
    }

    // Small delay to avoid Telegram rate limits
    await new Promise(r => setTimeout(r, 500));
  }
}

export default { isEnabled, sendMessage, testConnection, notifyPlaybackStarted, notifyPlaybackCompleted, notifyNewUser, notifyRecentlyAdded };
