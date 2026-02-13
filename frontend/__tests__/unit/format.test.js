import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatDuration,
  formatTimestamp,
  formatTimeAgo,
  formatMediaType,
  setTimezone,
  getTimezone,
} from '../../src/utils/format';

describe('formatDuration', () => {
  it('returns N/A for null or 0', () => {
    expect(formatDuration(null)).toBe('N/A');
    expect(formatDuration(0)).toBe('N/A');
    expect(formatDuration(undefined)).toBe('N/A');
  });

  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats hours and minutes without seconds by default', () => {
    expect(formatDuration(3661)).toBe('1h 1m');
  });

  it('formats hours, minutes, and seconds when showSeconds is true', () => {
    expect(formatDuration(3661, true)).toBe('1h 1m 1s');
  });

  it('formats exact hours', () => {
    expect(formatDuration(7200)).toBe('2h 0m');
  });

  it('formats exact minutes', () => {
    expect(formatDuration(60)).toBe('1m 0s');
  });
});

describe('formatTimestamp', () => {
  beforeEach(() => {
    setTimezone('UTC');
  });

  it('returns N/A for null or 0', () => {
    expect(formatTimestamp(null)).toBe('N/A');
    expect(formatTimestamp(0)).toBe('N/A');
  });

  it('formats a unix timestamp to readable string', () => {
    // Jan 15, 2024 12:30 PM UTC
    const timestamp = 1705321800;
    expect(formatTimestamp(timestamp)).toBe('Jan 15, 2024 12:30 PM');
  });

  it('respects explicit timezone parameter', () => {
    const timestamp = 1705321800; // Jan 15, 2024 12:30 PM UTC
    const result = formatTimestamp(timestamp, 'America/New_York');
    expect(result).toBe('Jan 15, 2024 7:30 AM');
  });

  it('uses currentTimezone when no explicit timezone given', () => {
    setTimezone('America/Los_Angeles');
    const timestamp = 1705321800; // Jan 15, 2024 12:30 PM UTC
    const result = formatTimestamp(timestamp);
    expect(result).toBe('Jan 15, 2024 4:30 AM');
  });
});

describe('formatTimeAgo', () => {
  it('returns "Never" for null or 0', () => {
    expect(formatTimeAgo(null)).toBe('Never');
    expect(formatTimeAgo(0)).toBe('Never');
  });

  it('returns a relative time string with "ago" suffix', () => {
    const now = Math.floor(Date.now() / 1000);
    const fiveMinutesAgo = now - 300;
    const result = formatTimeAgo(fiveMinutesAgo);
    expect(result).toContain('ago');
    expect(result).toContain('5');
    expect(result).toContain('minute');
  });
});

describe('formatMediaType', () => {
  it('maps known types correctly', () => {
    expect(formatMediaType('movie')).toBe('Movie');
    expect(formatMediaType('episode')).toBe('Episode');
    expect(formatMediaType('track')).toBe('Music');
    expect(formatMediaType('audiobook')).toBe('Audiobook');
    expect(formatMediaType('book')).toBe('Book');
  });

  it('capitalizes unknown types', () => {
    expect(formatMediaType('podcast')).toBe('Podcast');
    expect(formatMediaType('live')).toBe('Live');
  });
});

describe('setTimezone / getTimezone', () => {
  it('defaults to UTC', () => {
    setTimezone(null);
    expect(getTimezone()).toBe('UTC');
  });

  it('stores and retrieves a timezone', () => {
    setTimezone('America/Chicago');
    expect(getTimezone()).toBe('America/Chicago');
  });

  it('resets to UTC when given empty string', () => {
    setTimezone('Europe/London');
    setTimezone('');
    expect(getTimezone()).toBe('UTC');
  });
});
