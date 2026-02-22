import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardStats, getActivity, getWsToken, getRecentlyAdded, getRecentRequests } from '../utils/api';
import { formatDuration } from '../utils/format';
import { Users, Headphones, ChevronDown, Book, Play, MapPin, Film, Tv, Clock } from 'lucide-react';

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

  const isAudiobook = serverType === 'audiobookshelf' || serverType === 'sappho';
  const sizeClass = isAudiobook ? 'max-w-full max-h-full' : className;
  const objectFit = isAudiobook ? 'object-contain' : 'object-cover';

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={`${sizeClass} ${objectFit} rounded`}
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
      case 'seerr':
        return <img src="/logos/seerr.svg" alt="Seerr" className={size} title="Seerr" />;
      default:
        return null;
    }
  };

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
  const [recentlyAdded, setRecentlyAdded] = useState(null);
  const [recentRequests, setPendingRequests] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const recentRefreshRef = useRef(null);

  const connectWebSocket = useCallback(async () => {
    try {
      const token = await getWsToken();
      if (!token) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

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
          // Debounced refresh of recently added on any WS message
          if (!recentRefreshRef.current) {
            recentRefreshRef.current = setTimeout(async () => {
              recentRefreshRef.current = null;
              try {
                const res = await getRecentlyAdded();
                setRecentlyAdded(res.data.data);
              } catch { /* silent refresh */ }
            }, 10000);
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        wsRef.current = null;

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

    const interval = setInterval(loadData, 30000);

    return () => {
      clearInterval(interval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (recentRefreshRef.current) {
        clearTimeout(recentRefreshRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const loadData = async () => {
    try {
      const [statsRes, activityRes, recentRes, requestsRes] = await Promise.all([
        getDashboardStats(),
        getActivity(),
        getRecentlyAdded(),
        getRecentRequests().catch(() => ({ data: { data: [] } })),
      ]);

      setStats(statsRes.data.data);
      setActivity(activityRes.data.data);
      setRecentlyAdded(recentRes.data.data);
      setPendingRequests(requestsRes.data.data);
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

  const sections = [
    stats.mostWatchedEpisodes?.length > 0 && {
      type: 'media', items: stats.mostWatchedEpisodes, category: 'shows', count: 5, span: '',
      icon: Tv, label: 'Popular Shows', accent: 'border-violet-400', iconColor: 'text-violet-400/70',
    },
    stats.mostWatchedMovies?.length > 0 && {
      type: 'media', items: stats.mostWatchedMovies, category: 'movies', count: 5, span: '',
      icon: Film, label: 'Popular Movies', accent: 'border-blue-400', iconColor: 'text-blue-400/70',
    },
    stats.mostWatchedAudiobooks?.length > 0 && {
      type: 'media', items: stats.mostWatchedAudiobooks, category: 'books', count: 5, span: '',
      icon: Book, label: 'Popular Books', accent: 'border-amber-400', iconColor: 'text-amber-400/70', bookMode: true,
    },
    stats.topWatchers?.length > 0 && {
      type: 'user', users: stats.topWatchers, count: 5, span: '',
      icon: Film, label: 'Top Watchers', accent: 'border-emerald-400', iconColor: 'text-emerald-400/70',
    },
    stats.topListeners?.length > 0 && {
      type: 'user', users: stats.topListeners, count: 5, span: '',
      icon: Headphones, label: 'Top Listeners', accent: 'border-rose-400', iconColor: 'text-rose-400/70',
    },
    recentRequests?.length > 0 && {
      type: 'request', requests: recentRequests, count: 5, span: '',
      icon: Clock, label: 'Requests', accent: 'border-teal-400', iconColor: 'text-teal-400/70',
    },
    stats.topLocations?.length > 0 && {
      type: 'location', locations: stats.topLocations, count: 10, span: '',
      icon: MapPin, label: 'Top Locations', accent: 'border-sky-400', iconColor: 'text-sky-400/70',
    },
  ].filter(Boolean);

  const recentItems = recentlyAdded?.recentItems || [];

  const renderMediaRows = (section) =>
    section.items.slice(0, section.count).map((item, index) => {
      const isExpanded = expandedItems[`${section.category}-${index}`];
      return (
        <div key={index}>
          <div
            className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/[0.03] transition-colors cursor-pointer"
            onClick={() => toggleExpanded(section.category, index)}
          >
            <span className="flex-shrink-0 w-4 text-center text-gray-600 text-[11px] font-mono">{index + 1}</span>
            <div className={`flex-shrink-0 ${section.bookMode ? 'w-10 h-10' : 'w-7 h-10'} rounded overflow-hidden bg-dark-700`}>
              <MediaThumbnail
                src={item.thumb}
                alt={item.title}
                title={item.title}
                serverType={section.bookMode ? 'audiobookshelf' : item.server_type}
                className="w-full h-full"
                iconSize="w-3 h-3"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-[13px] truncate" title={item.title}>{item.title}</div>
            </div>
            <ChevronDown className={`flex-shrink-0 w-3 h-3 text-gray-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </div>
          {isExpanded && (
            <div className="px-3 py-1 bg-dark-900/30">
              <div className="flex items-center gap-3 pl-6 py-1 text-[10px] text-gray-500">
                <span className="flex items-center gap-0.5">
                  <Users className="w-2.5 h-2.5" />
                  {item.users?.length || item.unique_users || item.plays} {(item.users?.length || item.unique_users || item.plays) === 1 ? 'user' : 'users'}
                </span>
                <span className="flex items-center gap-0.5">
                  <Play className="w-2.5 h-2.5" />
                  {item.plays} {item.plays === 1 ? 'play' : 'plays'}
                </span>
              </div>
              {item.users?.length > 0 && <div className="space-y-0.5 pl-6">
                {item.users.map((user, ui) => (
                  <div
                    key={ui}
                    onClick={(e) => { e.stopPropagation(); user.user_id && navigate(`/users/${user.user_id}`); }}
                    className="flex items-center gap-1.5 cursor-pointer hover:bg-white/[0.03] px-1.5 py-0.5 rounded transition-colors"
                  >
                    {user.thumb ? (
                      <img src={`/proxy/image?url=${encodeURIComponent(user.thumb)}`} alt={user.username} className="w-4 h-4 rounded-full object-cover" />
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-primary-600 flex items-center justify-center">
                        <span className="text-[9px] text-white font-semibold">{user.username.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <span className="text-[11px] text-white truncate">{user.username}</span>
                  </div>
                ))}
              </div>}
            </div>
          )}
        </div>
      );
    });

  const renderUserRows = (section) =>
    section.users.slice(0, section.count).map((user, index) => {
      const userKey = `user-${user.username}`;
      const isExpanded = expandedItems[userKey];
      return (
        <div key={user.username}>
          <div
            className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/[0.03] transition-colors cursor-pointer"
            onClick={() => setExpandedItems(prev => ({ ...prev, [userKey]: !prev[userKey] }))}
          >
            <span className="flex-shrink-0 w-4 text-center text-gray-600 text-[11px] font-mono">{index + 1}</span>
            {user.thumb ? (
              <img
                src={`/proxy/image?url=${encodeURIComponent(user.thumb)}`}
                alt={user.username}
                className="flex-shrink-0 w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <div className="flex-shrink-0 w-6 h-6 bg-primary-600 rounded-full flex items-center justify-center text-white text-[10px] font-medium">
                {user.username.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <span className="text-white text-[13px] truncate block">{user.username}</span>
            </div>
            <ChevronDown className={`flex-shrink-0 w-3 h-3 text-gray-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </div>
          {isExpanded && (
            <div className="px-3 py-1 bg-dark-900/30">
              <div className="flex items-center gap-3 pl-6 py-1 text-[10px] text-gray-500">
                <span className="flex items-center gap-0.5">
                  <Play className="w-2.5 h-2.5" />
                  {formatDuration(user.total_duration)}
                </span>
                <span className="flex items-center gap-0.5">
                  {user.plays || user.total_plays || 0} plays
                </span>
              </div>
            </div>
          )}
        </div>
      );
    });

  const renderLocationRows = (section) => (
    <div className="flex flex-wrap items-stretch">
      {section.locations.slice(0, section.count).map((location, index) => (
        <div key={index} className="flex-1 min-w-[100px] px-3 py-2 text-center border-r border-dark-700 last:border-r-0">
          <div className="text-white text-[13px] font-medium truncate" title={
            location.city === 'Local Network'
              ? 'Local Network'
              : `${location.city}${location.region ? `, ${location.region}` : ''}`
          }>
            {location.city === 'Local Network'
              ? 'Local Network'
              : location.city}
          </div>
          {location.city !== 'Local Network' && location.region && (
            <div className="text-[10px] text-gray-500 truncate">{location.region}</div>
          )}
          <div className="text-[10px] text-sky-400/70 mt-0.5">
            {location.streams} {location.streams === 1 ? 'stream' : 'streams'}
          </div>
          {location.users?.length > 0 && (
            <div className="flex items-center justify-center gap-1 mt-1">
              {location.users.slice(0, 3).map((user, ui) => (
                user.thumb ? (
                  <img key={ui} src={`/proxy/image?url=${encodeURIComponent(user.thumb)}`} alt={user.username} title={user.username} className="w-4 h-4 rounded-full object-cover" />
                ) : (
                  <div key={ui} className="w-4 h-4 rounded-full bg-primary-600 flex items-center justify-center" title={user.username}>
                    <span className="text-[8px] text-white font-semibold">{user.username.charAt(0).toUpperCase()}</span>
                  </div>
                )
              ))}
              {location.users.length > 3 && (
                <span className="text-[9px] text-gray-500">+{location.users.length - 3}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const renderRequestRows = (section) =>
    section.requests.slice(0, section.count).map((request) => {
      const timeAgo = request.createdAt ? (() => {
        const diff = Math.floor((Date.now() - new Date(request.createdAt).getTime()) / 1000);
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
      })() : '';

      return (
        <div key={request.id}>
          <div className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/[0.03] transition-colors">
            <div className="flex-shrink-0 w-7 h-10 rounded overflow-hidden bg-dark-700">
              {request.posterUrl ? (
                <img
                  src={request.posterUrl}
                  alt={request.title}
                  className="w-full h-full object-cover rounded"
                  loading="lazy"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Film className="w-3 h-3 text-gray-500" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-[13px] truncate" title={request.title}>
                {request.title}
                {request.year && <span className="text-gray-500 ml-1">({request.year})</span>}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                {request.requestedBy?.avatar ? (
                  <img src={request.requestedBy.avatar} alt="" className="w-3 h-3 rounded-full" />
                ) : (
                  <div className="w-3 h-3 rounded-full bg-teal-600 flex items-center justify-center">
                    <span className="text-[7px] text-white font-semibold">
                      {(request.requestedBy?.username || '?').charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <span className="truncate">{request.requestedBy?.username}</span>
                <span className="text-gray-600">·</span>
                <span>{timeAgo}</span>
              </div>
            </div>
            <span className="flex-shrink-0 text-[9px] text-teal-400/60 uppercase font-medium">
              {request.type === 'tv' ? 'TV' : 'Film'}
            </span>
          </div>
        </div>
      );
    });

  const recentBookTypes = ['audiobook', 'book', 'track', 'podcast'];

  const renderSection = (section) => {
    const Icon = section.icon;
    return (
      <div key={section.label} className={`bg-dark-800 rounded-lg overflow-hidden ${section.span}`}>
        <div className={`flex items-center gap-2 px-3 py-1.5 border-l-2 ${section.accent} bg-dark-700/30`}>
          <Icon className={`w-3 h-3 ${section.iconColor}`} />
          <span className="text-[11px] font-medium tracking-wider uppercase text-gray-500">{section.label}</span>
        </div>
        <div className="py-0.5">
          {section.type === 'media' && renderMediaRows(section)}
          {section.type === 'user' && renderUserRows(section)}
          {section.type === 'location' && renderLocationRows(section)}
          {section.type === 'request' && renderRequestRows(section)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Recently Added covers */}
      {recentItems.length > 0 && (
        <div className="bg-dark-800 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1 border-l-2 border-indigo-400 bg-dark-700/30">
            <Film className="w-2.5 h-2.5 text-indigo-400/70" />
            <span className="text-[10px] font-medium tracking-wider uppercase text-gray-500">Recently Added</span>
          </div>
          <div className="flex gap-1 p-1.5 overflow-x-auto scrollbar-thin scrollbar-thumb-dark-600">
            {recentItems.map((item, index) => {
              const isBook = recentBookTypes.includes((item.type || '').toLowerCase());
              const isYoutube = (item.type || '').toLowerCase() === 'youtube' || item.isYoutube;
              return (
                <div key={index} className="flex-shrink-0 w-[50px]" title={item.name}>
                  <div className="relative aspect-[2/3] rounded overflow-hidden bg-dark-700 shadow">
                    {isYoutube ? (
                      <div className="w-full h-full flex items-center justify-center p-0.5">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-dark-600 flex-shrink-0">
                          <MediaThumbnail
                            src={item.thumb}
                            alt={item.seriesName || item.name}
                            title={item.seriesName || item.name}
                            serverType={item.server_type}
                            className="w-full h-full rounded-full"
                            iconSize="w-3 h-3"
                          />
                        </div>
                      </div>
                    ) : isBook ? (
                      <div className="w-full h-full flex items-center justify-center p-0.5">
                        <MediaThumbnail
                          src={item.thumb}
                          alt={item.name}
                          title={item.name}
                          serverType={item.server_type}
                          className="max-w-full max-h-full rounded-sm"
                          iconSize="w-3 h-3"
                        />
                      </div>
                    ) : (
                      <MediaThumbnail
                        src={item.thumb}
                        alt={item.name}
                        title={item.name}
                        serverType={item.server_type}
                        className="w-full h-full"
                        iconSize="w-3 h-3"
                      />
                    )}
                    <div className="absolute bottom-0.5 right-0.5 bg-black/70 rounded-sm p-px backdrop-blur-sm">
                      {getServerIcon(item.server_type, 'w-2 h-2')}
                    </div>
                    {item.count > 1 && (
                      <div className="absolute top-0.5 right-0.5 bg-indigo-500 text-white text-[7px] font-bold rounded-full w-3 h-3 flex items-center justify-center shadow">
                        {item.count}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Active Streams */}
      {activity.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">
              Currently Streaming ({activity.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {activity.map((session) => (
              <div
                key={session.id}
                className={`card hover:border-primary-500 transition-colors ${session.state === 'playing' ? 'streaming-active' : ''}`}
              >
                <div className="flex p-2 gap-2">
                  {/* Poster */}
                  <div className="flex-shrink-0">
                    <div className="relative w-10 h-14 bg-dark-700 rounded overflow-hidden">
                      <MediaThumbnail
                        src={session.thumb}
                        alt={session.title}
                        title={session.title}
                        serverType={session.server_type}
                        className="w-full h-full"
                        iconSize="w-4 h-4"
                      />
                      <div className="absolute bottom-0.5 right-0.5 bg-black/70 rounded-sm p-px">
                        {getServerIcon(session.server_type, 'w-2 h-2')}
                      </div>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    {/* Title + status */}
                    <div>
                      <div className="flex items-start justify-between gap-1">
                        <h4 className="text-[12px] font-semibold text-white truncate" title={session.title}>
                          {session.title}
                        </h4>
                        <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full mt-1 ${
                          session.state === 'playing' ? 'bg-green-500' : session.state === 'paused' ? 'bg-yellow-500' : 'bg-gray-500'
                        }`} />
                      </div>
                      {session.parent_title ? (
                        <div className="flex items-center gap-1 text-[10px]">
                          <span className="text-gray-400 truncate">{session.parent_title}</span>
                          {session.season_number && session.episode_number && session.media_type === 'episode' && (
                            <span className="text-primary-400 font-semibold whitespace-nowrap">
                              S{String(session.season_number).padStart(2, '0')}E{String(session.episode_number).padStart(2, '0')}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-500 capitalize">{session.media_type}</span>
                      )}
                    </div>

                    {/* User */}
                    <div
                      className="flex items-center gap-1 cursor-pointer group mt-0.5"
                      onClick={() => navigate(`/users/${session.user_id}`)}
                    >
                      {session.user_thumb ? (
                        <img src={`/proxy/image?url=${encodeURIComponent(session.user_thumb)}`} alt={session.username} className="w-3.5 h-3.5 rounded-full object-cover" />
                      ) : (
                        <div className="w-3.5 h-3.5 bg-primary-600 rounded-full flex items-center justify-center text-white text-[8px] font-medium">
                          {session.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-[10px] text-gray-400 group-hover:text-primary-400 transition-colors truncate">{session.username}</span>
                    </div>

                    {/* Progress */}
                    <div className="mt-0.5">
                      <div className="bg-dark-600 rounded-full h-1">
                        <div className="bg-primary-500 h-1 rounded-full transition-all duration-300" style={{ width: `${session.progress_percent}%` }} />
                      </div>
                      <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
                        <span>
                          {session.current_time && session.duration
                            ? `${formatDuration(session.current_time, session.server_type === 'sappho')} / ${formatDuration(session.duration, session.server_type === 'sappho')}`
                            : session.duration ? formatDuration(session.duration, session.server_type === 'sappho') : ''}
                        </span>
                        <span>
                          {session.resolution ? formatResolution(session.resolution) : ''}
                          {session.server_type !== 'audiobookshelf' && (session.transcoding === 1 ? ' • TC' : ' • DP')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats grid */}
      {sections.filter(s => s.type !== 'location').length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2 items-start">
          {sections.filter(s => s.type !== 'location').map(renderSection)}
        </div>
      )}

      {/* Top Locations — full-width horizontal bar */}
      {sections.filter(s => s.type === 'location').map(renderSection)}

    </div>
  );
}

export default Dashboard;
