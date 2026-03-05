import axios from 'axios';
import db from '../database/init.js';

/**
 * IP Geolocation Service
 * Uses ip-api.com free service to lookup city, region, and country for IP addresses
 * Caches results in database to minimize API calls
 */
class GeolocationService {
  constructor() {
    this.apiUrl = 'http://ip-api.com/json';
    this.cache = new Map(); // In-memory cache for quick lookups
  }

  /**
   * Check if an IP address is private/local
   */
  /**
   * Check if an IP is a proxy/Docker artifact rather than a real client IP.
   * These get reported when the media server is behind a reverse proxy or
   * running in a container — they should be treated as "unknown", not "Local Network".
   */
  isProxyIP(ip) {
    if (!ip) return false;
    const proxyPatterns = [
      /^127\./,          // 127.0.0.0/8 (loopback — server talking to itself)
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (Docker bridge network)
      /^::1$/,           // IPv6 localhost
    ];
    return proxyPatterns.some(p => p.test(ip));
  }

  isPrivateIP(ip) {
    if (!ip) return true;

    // Proxy/Docker IPs are not real client IPs — don't classify as LAN
    if (this.isProxyIP(ip)) return false;

    // Real private/LAN IP ranges
    const privateRanges = [
      /^10\./,           // 10.0.0.0/8 (private)
      /^192\.168\./,     // 192.168.0.0/16 (private)
      /^fe80:/,          // IPv6 link-local
      /^fc00:/,          // IPv6 unique local
    ];

    return privateRanges.some(range => range.test(ip));
  }

  /**
   * Lookup geolocation for an IP address
   * Returns cached result if available, otherwise queries API
   */
  async lookup(ipAddress) {
    if (!ipAddress) {
      return this.getLocalNetworkLocation();
    }

    // Proxy/Docker IPs are not real client IPs — treat as unknown
    if (this.isProxyIP(ipAddress)) {
      return this.getUnknownLocation();
    }

    // Check if it's a real private/LAN IP
    if (this.isPrivateIP(ipAddress)) {
      return this.getLocalNetworkLocation();
    }

    // Check in-memory cache first
    if (this.cache.has(ipAddress)) {
      return this.cache.get(ipAddress);
    }

    // Check database cache
    try {
      const cached = db.prepare('SELECT * FROM ip_cache WHERE ip_address = ?').get(ipAddress);
      if (cached) {
        const location = {
          city: cached.city,
          region: cached.region,
          country: cached.country,
          countryCode: cached.country_code,
          timezone: cached.timezone,
          isp: cached.isp,
        };
        // Store in memory cache
        this.cache.set(ipAddress, location);
        return location;
      }
    } catch (error) {
      console.error('Error reading from IP cache:', error.message);
    }

    // Lookup from API
    try {
      console.log(`🌍 Looking up geolocation for IP: ${ipAddress}`);
      const response = await axios.get(`${this.apiUrl}/${ipAddress}`, {
        timeout: 5000,
        params: {
          fields: 'status,message,country,countryCode,region,regionName,city,timezone,isp',
        },
      });

      if (response.data.status === 'fail') {
        console.error(`IP geolocation lookup failed for ${ipAddress}: ${response.data.message}`);
        return this.getUnknownLocation();
      }

      const location = {
        city: response.data.city || null,
        region: response.data.regionName || null,
        country: response.data.country || null,
        countryCode: response.data.countryCode || null,
        timezone: response.data.timezone || null,
        isp: response.data.isp || null,
      };

      // Cache in database
      try {
        db.prepare(`
          INSERT OR REPLACE INTO ip_cache (ip_address, city, region, country, country_code, timezone, isp)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          ipAddress,
          location.city,
          location.region,
          location.country,
          location.countryCode,
          location.timezone,
          location.isp
        );
      } catch (error) {
        console.error('Error caching IP geolocation:', error.message);
      }

      // Cache in memory
      this.cache.set(ipAddress, location);

      return location;
    } catch (error) {
      console.error(`Error looking up IP ${ipAddress}:`, error.message);
      return this.getUnknownLocation();
    }
  }

  /**
   * Return location data for local network connections
   */
  getLocalNetworkLocation() {
    return {
      city: 'Local Network',
      region: null,
      country: null,
      countryCode: null,
      timezone: null,
      isp: null,
    };
  }

  /**
   * Return location data for unknown/failed lookups
   */
  getUnknownLocation() {
    return {
      city: 'Unknown',
      region: null,
      country: null,
      countryCode: null,
      timezone: null,
      isp: null,
    };
  }

  /**
   * Clear the in-memory cache (database cache persists)
   */
  clearMemoryCache() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const memorySize = this.cache.size;
    const dbSize = db.prepare('SELECT COUNT(*) as count FROM ip_cache').get().count;
    return {
      memoryCache: memorySize,
      databaseCache: dbSize,
    };
  }
}

// Export singleton instance
export default new GeolocationService();
