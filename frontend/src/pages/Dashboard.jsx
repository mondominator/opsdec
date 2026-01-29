import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardStats, getActivity, getAccessToken } from '../utils/api';
import { formatDuration, formatTimeAgo } from '../utils/format';
import { Users, PlayCircle, TrendingUp, Clock, Activity as ActivityIcon, Film, Tv, Headphones, ChevronDown, MapPin, Book } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Thumbnail component with error handling and placeholder
function MediaThumbnail({ src, alt, title, serverType, className = "w-full h-full", iconSize = "w-8 h-8" }) {
  const [hasError, setHasError] = useState(false);

  const imgSrc = src ? `/proxy/image?url=${encodeURIComponent(src)}` : null;

  if (hasError || !src) {
    return (
      <div className={`${className} bg-gradient-to-br from-dark-600 to-dark-700 rounded flex items-center justify-center`}>
        {serverType === 'audiobookshelf' || serverType === 'sappho' ? (
          <Book className={`${iconSize} text-gray-500`} />
        ) : (
          <span className="text-gray-400 font-bold text-lg">
            {title?.charAt(0)?.toUpperCase() || '?'}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={`${className} object-cover rounded`}
      loading="lazy"
      onError={() => setHasError(true)}
    />
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const getServerIcon = (serverType, size = 'w-5 h-5') => {
    switch (serverType) {
      case 'emby':
        return <img src="/logos/emby.svg" alt="Emby" className={size} title="Emby" />;
      case 'plex':
        return <img src="/logos/plex.svg" alt="Plex" className={size} title="Plex" />;
      case 'jellyfin':
        return <img src="/logos/jellyfin.svg" alt="Jellyfin" className={size} title="Jellyfin" />;
      case 'audiobookshelf':
        return <img src="/logos/audiobookshelf.svg" alt="Audiobookshelf" className={size} title="Audiobookshelf" />;
      case 'sappho':
        return <img src="/logos/sappho.png" alt="Sappho" className={`${size} rounded`} title="Sappho" />;
      default:
        return null;
    }
  };
  // Helper function to format resolution
  const formatResolution = (resolution) => {
    if (!resolution) return null;
    const height = parseInt(resolution.split('x')[1]);
    if (height >= 2160) return '4K';
    if (height >= 1440) return '1440p';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    return resolution;
  };
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedItems, setExpandedItems] = useState({});
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // WebSocket connection with authentication
  const connectWebSocket = useCallback(() => {
    const token = getAccessToken();
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'session.update') {
            setActivity(data.data || []);
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        wsRef.current = null;

        // Reconnect after 5 seconds unless auth error
        if (event.code !== 4001 && event.code !== 4003) {
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, 5000);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  }, []);

  useEffect(() => {
    loadData();
    connectWebSocket();

    const interval = setInterval(loadData, 30000); // Refresh stats every 30 seconds (activity via WebSocket)

    return () => {
      clearInterval(interval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const loadData = async () => {
    try {
      const [statsRes, activityRes] = await Promise.all([
        getDashboardStats(),
        getActivity(),
      ]);

      setStats(statsRes.data.data);
      setActivity(activityRes.data.data);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (category, index) => {
    const key = `${category}-${index}`;
    setExpandedItems(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">No data available</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Active Streams */}
      {activity.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">
              Currently Streaming ({activity.length})
            </h3>
          </div>
          <div className="space-y-4 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-4 md:space-y-0">
            {activity.map((session) => (
              <div
                key={session.id}
                className={`card hover:border-primary-500 transition-colors ${session.state === 'playing' ? 'streaming-active' : ''}`}
              >
                {/* Mobile View - Compact */}
                <div className="flex md:hidden p-3 gap-3">
                  {/* Thumbnail */}
                  <div className="flex-shrink-0">
                    <div className="relative w-16 h-24 bg-dark-700 rounded overflow-hidden">
                      <MediaThumbnail
                        src={session.thumb}
                        alt={session.title}
                        title={session.title}
                        serverType={session.server_type}
                        className="w-full h-full"
                        iconSize="w-8 h-8"
                      />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Title and Status */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="text-sm font-semibold text-white line-clamp-1" title={session.title}>
                        {session.title}
                      </h4>
                      <span
                        className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${
                          session.state === 'playing'
                            ? 'bg-green-500/20 text-green-400'
                            : session.state === 'paused'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {session.state === 'playing' ? '▶' : session.state === 'paused' ? '⏸' : '⏹'}
                      </span>
                    </div>

                    {/* User and Server */}
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                      <span className="truncate">{session.username}</span>
                      <span>•</span>
                      {getServerIcon(session.server_type, session.server_type === 'sappho' ? 'w-4 h-4' : 'w-3.5 h-3.5')}
                    </div>

                    {/* Progress bar */}
                    <div className="mb-1">
                      <div className="bg-dark-600 rounded-full h-1.5">
                        <div
                          className="bg-primary-500 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${session.progress_percent}%` }}
                        />
                      </div>
                    </div>

                    {/* Time */}
                    <div className="text-xs text-gray-500">
                      {session.current_time && session.duration
                        ? `${formatDuration(session.current_time, session.server_type === 'sappho')} / ${formatDuration(session.duration, session.server_type === 'sappho')}`
                        : session.duration
                        ? formatDuration(session.duration, session.server_type === 'sappho')
                        : 'Unknown'}
                      {session.progress_percent > 0 && ` • ${session.progress_percent}%`}
                    </div>
                  </div>
                </div>

                {/* Desktop View - Full Details */}
                <div className="hidden md:flex p-4 gap-4">
                  {/* Thumbnail and Server Label */}
                  <div className="flex-shrink-0">
                    <div className="relative w-24 h-36 bg-dark-700 rounded-lg mb-3 overflow-hidden">
                      <MediaThumbnail
                        src={session.thumb}
                        alt={session.title}
                        title={session.title}
                        serverType={session.server_type}
                        className="w-full h-full"
                        iconSize="w-12 h-12"
                      />
                    </div>
                    {/* Server label */}
                    <div className={`flex items-center justify-center text-xs font-semibold ${session.server_type === 'sappho' ? '-space-x-0.5' : 'gap-1 capitalize'}`}>
                      {getServerIcon(session.server_type, session.server_type === 'sappho' ? 'w-5 h-5' : 'w-3.5 h-3.5')}
                      <span className={
                        session.server_type === 'emby' ? 'text-green-400' :
                        session.server_type === 'plex' ? 'text-yellow-400' :
                        session.server_type === 'jellyfin' ? 'text-purple-400' :
                        session.server_type === 'audiobookshelf' ? 'text-amber-600' :
                        session.server_type === 'sappho' ? 'text-blue-400' :
                        'text-gray-400'
                      }>
                        {session.server_type === 'sappho' ? 'appho' : session.server_type}
                      </span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 flex flex-col">
                    {/* Title and Status */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-white line-clamp-2" title={session.title}>
                          {session.title}
                        </h4>
                        {session.parent_title && (
                          <div className="flex items-center gap-2 text-xs mt-1">
                            <span className="text-gray-400 truncate">{session.parent_title}</span>
                            {session.season_number && session.episode_number && session.media_type === 'episode' && (
                              <span className="text-primary-400 font-semibold whitespace-nowrap">
                                S{String(session.season_number).padStart(2, '0')}E{String(session.episode_number).padStart(2, '0')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <span
                        className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold ${
                          session.state === 'playing'
                            ? 'bg-green-500/20 text-green-400'
                            : session.state === 'paused'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {session.state === 'playing'
                          ? (['audiobook', 'track', 'book', 'music'].includes(session.media_type) ? 'Listening' : 'Playing')
                          : session.state === 'paused'
                          ? 'Paused'
                          : 'Stopped'}
                      </span>
                    </div>

                    {/* User and Platform info */}
                    <div className="flex items-center gap-4 text-sm text-gray-400 mb-3">
                      <div
                        className="flex items-center gap-2 cursor-pointer group"
                        onClick={() => navigate(`/users/${session.user_id}`)}
                      >
                        {session.user_thumb ? (
                          <img
                            src={`/proxy/image?url=${encodeURIComponent(session.user_thumb)}`}
                            alt={session.username}
                            className="w-6 h-6 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-6 h-6 bg-primary-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                            {session.username.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="group-hover:text-primary-400 transition-colors">{session.username}</span>
                      </div>
                      <span>•</span>
                      <span className="capitalize">{session.media_type}</span>
                    </div>

                    {/* Location info */}
                    {(session.city || session.ip_address) && (
                      <div className="text-xs text-gray-500 mb-3">
                        {session.city === 'Local Network' ? (
                          <span>Local Network</span>
                        ) : session.city ? (
                          <span>{session.city}{session.region ? `, ${session.region}` : ''}{session.country ? `, ${session.country}` : ''}</span>
                        ) : session.ip_address ? (
                          <span>{session.ip_address}</span>
                        ) : null}
                      </div>
                    )}

                    {/* Progress bar */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>
                          {session.current_time && session.duration
                            ? `${formatDuration(session.current_time, session.server_type === 'sappho')} / ${formatDuration(session.duration, session.server_type === 'sappho')}`
                            : session.duration
                            ? formatDuration(session.duration, session.server_type === 'sappho')
                            : 'Unknown'}
                        </span>
                        {session.progress_percent > 0 && (
                          <span>{session.progress_percent}%</span>
                        )}
                      </div>
                      <div className="bg-dark-600 rounded-full h-2">
                        <div
                          className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${session.progress_percent}%` }}
                        />
                      </div>
                    </div>

                    {/* Stream info */}
                    <div className="flex items-center flex-wrap gap-x-4 gap-y-2 text-xs">
                      {session.resolution && (
                        <span className="text-white font-semibold">{formatResolution(session.resolution)}</span>
                      )}
                      {session.video_codec && (
                        <span className="text-gray-400">{session.video_codec.toUpperCase()}</span>
                      )}
                      {session.audio_codec && (
                        <span className="text-gray-400">{session.audio_codec.toUpperCase()}</span>
                      )}
                      {session.container && (
                        <span className="text-gray-400">{session.container.toUpperCase()}</span>
                      )}
                      {session.bitrate && (
                        <span className="text-primary-400 font-semibold">
                          {session.server_type === 'audiobookshelf'
                            ? `${Math.round(session.bitrate / 1000)} kbps`
                            : `${session.bitrate} Mbps`}
                        </span>
                      )}
                      {session.audio_channels && (
                        <span className="text-gray-400">{session.audio_channels === 1 ? 'Mono' : session.audio_channels === 2 ? 'Stereo' : `${session.audio_channels}ch`}</span>
                      )}
                      {session.server_type !== 'audiobookshelf' && (
                        session.transcoding === 1 ? (
                          <span className="text-yellow-500 font-semibold whitespace-nowrap">Transcoding</span>
                        ) : (
                          <span className="text-green-500 font-semibold whitespace-nowrap">Direct Play</span>
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Users and Popular - Grid layout */}
      {(stats.topWatchers?.length > 0 || stats.topListeners?.length > 0 || stats.mostWatchedMovies?.length > 0 || stats.mostWatchedEpisodes?.length > 0 || stats.mostWatchedAudiobooks?.length > 0 || stats.topLocations?.length > 0) && (
        <div className="flex flex-col md:flex-row gap-3 w-full">
          {/* Top Watchers */}
          {stats.topWatchers?.length > 0 && (
            <div className="card flex-1 min-w-0">
              <div className="card-header">
                <h3 className="card-title text-center">Top Watchers</h3>
              </div>
              <div className="card-body p-0">
                <div className="divide-y divide-dark-600">
                  {stats.topWatchers.slice(0, 5).map((user, index) => (
                    <div
                      key={user.username}
                      onClick={() => user.user_id && navigate(`/users/${user.user_id}`)}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-dark-700 transition-colors cursor-pointer"
                    >
                      <div className="flex-shrink-0 w-4 text-center text-gray-500 text-xs">
                        {index + 1}
                      </div>
                      {user.thumb ? (
                        <img
                          src={`/proxy/image?url=${encodeURIComponent(user.thumb)}`}
                          alt={user.username}
                          className="flex-shrink-0 w-6 h-6 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex-shrink-0 w-6 h-6 bg-primary-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="text-white text-xs">{user.username}</div>
                        <div className="text-xs text-gray-500">
                          {formatDuration(user.total_duration)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* Top Listeners */}
          {stats.topListeners?.length > 0 && (
            <div className="card flex-1 min-w-0">
              <div className="card-header">
                <h3 className="card-title text-center">Top Listeners</h3>
              </div>
              <div className="card-body p-0">
                <div className="divide-y divide-dark-600">
                  {stats.topListeners.slice(0, 5).map((user, index) => (
                    <div
                      key={user.username}
                      onClick={() => user.user_id && navigate(`/users/${user.user_id}`)}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-dark-700 transition-colors cursor-pointer"
                    >
                      <div className="flex-shrink-0 w-4 text-center text-gray-500 text-xs">
                        {index + 1}
                      </div>
                      {user.thumb ? (
                        <img
                          src={`/proxy/image?url=${encodeURIComponent(user.thumb)}`}
                          alt={user.username}
                          className="flex-shrink-0 w-6 h-6 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex-shrink-0 w-6 h-6 bg-primary-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="text-white text-xs">{user.username}</div>
                        <div className="text-xs text-gray-500">
                          {formatDuration(user.total_duration)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* Popular Movies */}
          {stats.mostWatchedMovies?.length > 0 && (
            <div className="card flex-1 min-w-0">
              <div className="card-header">
                <h3 className="card-title text-center">Popular Movies</h3>
              </div>
              <div className="card-body p-0">
                <div className="divide-y divide-dark-600">
                  {stats.mostWatchedMovies.slice(0, 5).map((item, index) => {
                    const isExpanded = expandedItems[`movies-${index}`];
                    return (
                      <div key={index}>
                        <div
                          className="flex items-start gap-2 px-3 py-1.5 hover:bg-dark-700 transition-colors cursor-pointer"
                          onClick={() => toggleExpanded('movies', index)}
                        >
                          {/* Rank */}
                          <div className="flex-shrink-0 w-4 text-center text-gray-500 text-xs pt-0.5">
                            {index + 1}
                          </div>
                          {/* Thumbnail */}
                          <div className="flex-shrink-0 relative w-6 h-9">
                            <MediaThumbnail
                              src={item.thumb}
                              alt={item.title}
                              title={item.title}
                              serverType={item.server_type}
                              className="w-full h-full"
                              iconSize="w-3 h-3"
                            />
                          </div>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-xs leading-tight truncate" title={item.title}>
                              {item.title}
                            </div>
                            <div className="text-xs text-gray-500">
                              {item.unique_users || item.plays} {(item.unique_users || item.plays) === 1 ? 'viewer' : 'viewers'}
                              {item.plays > (item.unique_users || item.plays) && <span className="text-gray-600"> · {item.plays} plays</span>}
                            </div>
                          </div>
                          {/* Chevron */}
                          <div className="flex-shrink-0">
                            <ChevronDown
                              className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </div>
                        {/* User List Dropdown */}
                        {isExpanded && item.users && item.users.length > 0 && (
                          <div className="px-3 py-2 bg-dark-800 border-t border-dark-600">
                            <div className="text-xs text-gray-400 mb-2">Watched by:</div>
                            <div className="space-y-1">
                              {item.users.map((user, userIndex) => (
                                <div
                                  key={userIndex}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    user.user_id && navigate(`/users/${user.user_id}`);
                                  }}
                                  className="flex items-center gap-2 cursor-pointer hover:bg-dark-700 p-1 rounded transition-colors"
                                >
                                  {user.thumb ? (
                                    <img
                                      src={`/proxy/image?url=${encodeURIComponent(user.thumb)}`}
                                      alt={user.username}
                                      className="w-5 h-5 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center">
                                      <span className="text-xs text-white font-semibold">
                                        {user.username.charAt(0).toUpperCase()}
                                      </span>
                                    </div>
                                  )}
                                  <span className="text-xs text-white">{user.username}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Popular TV Shows */}
          {stats.mostWatchedEpisodes?.length > 0 && (
            <div className="card flex-1 min-w-0">
              <div className="card-header">
                <h3 className="card-title text-center">Popular Shows</h3>
              </div>
              <div className="card-body p-0">
                <div className="divide-y divide-dark-600">
                  {stats.mostWatchedEpisodes.slice(0, 5).map((item, index) => {
                    const isExpanded = expandedItems[`shows-${index}`];
                    return (
                      <div key={index}>
                        <div
                          className="flex items-start gap-2 px-3 py-1.5 hover:bg-dark-700 transition-colors cursor-pointer"
                          onClick={() => toggleExpanded('shows', index)}
                        >
                          {/* Rank */}
                          <div className="flex-shrink-0 w-4 text-center text-gray-500 text-xs pt-0.5">
                            {index + 1}
                          </div>
                          {/* Thumbnail */}
                          <div className="flex-shrink-0 relative w-6 h-9">
                            <MediaThumbnail
                              src={item.thumb}
                              alt={item.title}
                              title={item.title}
                              serverType={item.server_type}
                              className="w-full h-full"
                              iconSize="w-3 h-3"
                            />
                          </div>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-xs leading-tight truncate" title={item.title}>
                              {item.title}
                            </div>
                            <div className="text-xs text-gray-500">
                              {item.unique_users || item.plays} {(item.unique_users || item.plays) === 1 ? 'watcher' : 'watchers'}
                              {item.plays > (item.unique_users || item.plays) && <span className="text-gray-600"> · {item.plays} plays</span>}
                            </div>
                          </div>
                          {/* Chevron */}
                          <div className="flex-shrink-0">
                            <ChevronDown
                              className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </div>
                        {/* User List Dropdown */}
                        {isExpanded && item.users && item.users.length > 0 && (
                          <div className="px-3 py-2 bg-dark-800 border-t border-dark-600">
                            <div className="text-xs text-gray-400 mb-2">Watched by:</div>
                            <div className="space-y-1">
                              {item.users.map((user, userIndex) => (
                                <div
                                  key={userIndex}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    user.user_id && navigate(`/users/${user.user_id}`);
                                  }}
                                  className="flex items-center gap-2 cursor-pointer hover:bg-dark-700 p-1 rounded transition-colors"
                                >
                                  {user.thumb ? (
                                    <img
                                      src={`/proxy/image?url=${encodeURIComponent(user.thumb)}`}
                                      alt={user.username}
                                      className="w-5 h-5 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center">
                                      <span className="text-xs text-white font-semibold">
                                        {user.username.charAt(0).toUpperCase()}
                                      </span>
                                    </div>
                                  )}
                                  <span className="text-xs text-white">{user.username}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Popular Books */}
          {stats.mostWatchedAudiobooks?.length > 0 && (
            <div className="card flex-1 min-w-0">
              <div className="card-header">
                <h3 className="card-title text-center">Popular Books</h3>
              </div>
              <div className="card-body p-0">
                <div className="divide-y divide-dark-600">
                  {stats.mostWatchedAudiobooks.slice(0, 5).map((item, index) => {
                    const isExpanded = expandedItems[`books-${index}`];
                    return (
                      <div key={index}>
                        <div
                          className="flex items-start gap-2 px-3 py-1.5 hover:bg-dark-700 transition-colors cursor-pointer"
                          onClick={() => toggleExpanded('books', index)}
                        >
                          {/* Rank */}
                          <div className="flex-shrink-0 w-4 text-center text-gray-500 text-xs pt-0.5">
                            {index + 1}
                          </div>
                          {/* Thumbnail */}
                          <div className="flex-shrink-0 relative w-6 h-9">
                            <MediaThumbnail
                              src={item.thumb}
                              alt={item.title}
                              title={item.title}
                              serverType="audiobookshelf"
                              className="w-full h-full"
                              iconSize="w-3 h-3"
                            />
                          </div>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-xs leading-tight truncate" title={item.title}>
                              {item.title}
                            </div>
                            <div className="text-xs text-gray-500">
                              {item.unique_users || item.plays} {(item.unique_users || item.plays) === 1 ? 'listener' : 'listeners'}
                              {item.plays > (item.unique_users || item.plays) && <span className="text-gray-600"> · {item.plays} plays</span>}
                            </div>
                          </div>
                          {/* Chevron */}
                          <div className="flex-shrink-0">
                            <ChevronDown
                              className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </div>
                        {/* User List Dropdown */}
                        {isExpanded && item.users && item.users.length > 0 && (
                          <div className="px-3 py-2 bg-dark-800 border-t border-dark-600">
                            <div className="text-xs text-gray-400 mb-2">Listened by:</div>
                            <div className="space-y-1">
                              {item.users.map((user, userIndex) => (
                                <div
                                  key={userIndex}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    user.user_id && navigate(`/users/${user.user_id}`);
                                  }}
                                  className="flex items-center gap-2 cursor-pointer hover:bg-dark-700 p-1 rounded transition-colors"
                                >
                                  {user.thumb ? (
                                    <img
                                      src={`/proxy/image?url=${encodeURIComponent(user.thumb)}`}
                                      alt={user.username}
                                      className="w-5 h-5 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center">
                                      <span className="text-xs text-white font-semibold">
                                        {user.username.charAt(0).toUpperCase()}
                                      </span>
                                    </div>
                                  )}
                                  <span className="text-xs text-white">{user.username}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Top Locations */}
          {stats.topLocations?.length > 0 && (
            <div className="card flex-1 min-w-0">
              <div className="card-header">
                <h3 className="card-title text-center">Top Locations</h3>
              </div>
              <div className="card-body p-0">
                <div className="divide-y divide-dark-600">
                  {stats.topLocations.slice(0, 10).map((location, index) => {
                    const locationKey = `location-${location.city}-${location.region}`;
                    const isExpanded = expandedItems[locationKey];

                    return (
                      <div key={index}>
                        <div
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-dark-700 transition-colors cursor-pointer"
                          onClick={() => setExpandedItems(prev => ({
                            ...prev,
                            [locationKey]: !prev[locationKey]
                          }))}
                        >
                          <div className="flex-shrink-0 w-4 text-center text-gray-500 text-xs">
                            {index + 1}
                          </div>
                          <div>
                            <div className="text-white text-xs">
                              {location.city === 'Local Network'
                                ? 'Local Network'
                                : `${location.city}${location.region ? `, ${location.region}` : ''}`
                              }
                            </div>
                            <div className="text-xs text-gray-500">
                              {location.streams} {location.streams === 1 ? 'stream' : 'streams'}
                            </div>
                          </div>
                          <ChevronDown
                            className={`flex-shrink-0 w-4 h-4 text-gray-500 transition-transform ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                          />
                        </div>

                        {isExpanded && location.users?.length > 0 && (
                          <div className="px-3 py-2 bg-dark-800 border-t border-dark-600">
                            <div className="text-xs text-gray-400 mb-2">Streams from:</div>
                            <div className="space-y-1">
                              {location.users.map((user, userIndex) => (
                                <div key={userIndex} className="flex items-center gap-2">
                                  {user.thumb ? (
                                    <img
                                      src={`/proxy/image?url=${encodeURIComponent(user.thumb)}`}
                                      alt={user.username}
                                      className="w-5 h-5 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center">
                                      <span className="text-xs text-white font-semibold">
                                        {user.username.charAt(0).toUpperCase()}
                                      </span>
                                    </div>
                                  )}
                                  <span className="text-xs text-white">{user.username}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Dashboard;
