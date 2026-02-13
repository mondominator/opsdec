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

export default { isEnabled, sendMessage, testConnection, notifyPlaybackStarted, notifyPlaybackCompleted, notifyNewUser };
