import { formatDistanceToNow, format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

// Timezone state - will be set by the app
let currentTimezone = 'UTC';

export const setTimezone = (timezone) => {
  currentTimezone = timezone || 'UTC';
};

export const getTimezone = () => currentTimezone;

export const formatDuration = (seconds, showSeconds = false) => {
  if (!seconds) return 'N/A';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return showSeconds ? `${hours}h ${minutes}m ${secs}s` : `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
};

export const formatTimestamp = (timestamp, timezone = null) => {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp * 1000);
  const tz = timezone || currentTimezone;
  return formatInTimeZone(date, tz, 'MMM d, yyyy h:mm a');
};

export const formatTimeAgo = (timestamp) => {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp * 1000);
  return formatDistanceToNow(date, { addSuffix: true });
};

export const formatMediaType = (type) => {
  const types = {
    movie: 'Movie',
    episode: 'Episode',
    track: 'Music',
    audiobook: 'Audiobook',
    book: 'Book',
  };
  return types[type] || type.charAt(0).toUpperCase() + type.slice(1);
};
