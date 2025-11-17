import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getUserStats } from '../utils/api';
import { formatTimeAgo, formatDuration } from '../utils/format';
import { ArrowLeft, Film, Tv, Headphones, Music, Book, Server, Clock, Play, Activity, Link2, MapPin, ChevronDown, ChevronUp, Globe } from 'lucide-react';

function UserDetails() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showMappedAccounts, setShowMappedAccounts] = useState(false);

  useEffect(() => {
    loadUserStats();
  }, [userId]);

  const loadUserStats = async () => {
    try {
      const response = await getUserStats(userId);
      setStats(response.data.data);
    } catch (error) {
      console.error('Error loading user stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">User not found</p>
      </div>
    );
  }

  const getMediaIcon = (type) => {
    switch (type) {
      case 'movie': return <Film className="w-5 h-5" />;
      case 'episode': return <Tv className="w-5 h-5" />;
      case 'track': return <Music className="w-5 h-5" />;
      case 'audiobook': return <Book className="w-5 h-5" />;
      default: return <Headphones className="w-5 h-5" />;
    }
  };

  const getServerIcon = (serverType) => {
    switch (serverType) {
      case 'emby':
        return <img src="/logos/emby.svg" alt="Emby" className="w-5 h-5" title="Emby" />;
      case 'plex':
        return <img src="/logos/plex.svg" alt="Plex" className="w-5 h-5" title="Plex" />;
      case 'audiobookshelf':
        return <img src="/logos/audiobookshelf.svg" alt="Audiobookshelf" className="w-5 h-5" title="Audiobookshelf" />;
      case 'sappho':
        return <img src="/logos/sappho.svg" alt="Sappho" className="w-5 h-5" title="Sappho" />;
      default:
        return <Server className="w-5 h-5 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Back Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/users')}
          className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </button>
        <h1 className="text-2xl font-bold text-white">User Details</h1>
      </div>

      {/* User Profile Card */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden w-fit max-w-full">
        <div className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
            {/* Avatar */}
            <div className="flex-shrink-0">
              {stats.user.thumb ? (
                <img
                  src={`/proxy/image?url=${encodeURIComponent(stats.user.thumb)}`}
                  alt={stats.user.username}
                  className="w-24 h-24 rounded-xl object-cover"
                />
              ) : (
                <div className="w-24 h-24 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-3xl font-bold">
                  {stats.user.username.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* User Info */}
            <div className="flex-1">
              <div className="mb-2">
                <h2 className="text-2xl font-bold text-white inline">{stats.user.username}</h2>
                {stats.user.last_seen && (
                  <span className="ml-3 text-sm text-gray-400">
                    <Clock className="w-3 h-3 inline mr-1" />
                    Last Seen {formatTimeAgo(stats.user.last_seen)}
                  </span>
                )}
              </div>

              {stats.user.email && (
                <p className="text-gray-400 mb-3">{stats.user.email}</p>
              )}

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2">
                {stats.user.is_admin === 1 && (
                  <span className="px-3 py-1 bg-primary-500/20 text-primary-400 rounded-full text-xs font-medium border border-primary-500/30">
                    Admin
                  </span>
                )}
                <span className={`px-3 py-1 rounded-full text-xs font-medium border ${stats.user.history_enabled ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
                  History {stats.user.history_enabled ? 'Enabled' : 'Disabled'}
                </span>
                {stats.user.is_mapped && stats.user.mapped_usernames && stats.user.mapped_usernames.length > 0 && (
                  <button
                    onClick={() => setShowMappedAccounts(!showMappedAccounts)}
                    className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-xs font-medium border border-blue-500/30 flex items-center gap-1.5 hover:bg-blue-500/30 transition-colors"
                  >
                    <Link2 className="w-3 h-3" />
                    Mapped User ({stats.user.mapped_servers} servers)
                    {showMappedAccounts ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                )}
                {stats.user.server_types && stats.user.server_types.map((serverType, index) => (
                  <span key={index} className="px-3 py-1 bg-dark-700 rounded-full text-xs font-medium border border-dark-600 flex items-center gap-1.5">
                    {getServerIcon(serverType)}
                    <span className="capitalize">{serverType}</span>
                  </span>
                ))}
              </div>

              {/* Mapped Accounts Dropdown */}
              {showMappedAccounts && stats.user.is_mapped && stats.user.mapped_usernames && stats.user.mapped_usernames.length > 0 && (
                <div className="mt-3 p-3 bg-dark-700/30 rounded-lg border border-dark-600">
                  <div className="text-xs font-medium text-gray-400 mb-2">Linked Accounts</div>
                  <div className="space-y-1.5">
                    {stats.user.mapped_usernames.map((account, index) => (
                      <div key={index} className="flex items-center gap-2 text-xs">
                        <div className="flex items-center gap-2 px-2 py-1 bg-dark-800 rounded border border-dark-600">
                          {getServerIcon(account.server_type)}
                          <span className="text-gray-300">{account.username}</span>
                          <span className="text-gray-500">on</span>
                          <span className="text-gray-400 capitalize">{account.server_type}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Row - Usage Stats, Media Type, and Server Usage */}
      <div className="flex flex-wrap gap-4 items-start">
        {/* Usage Statistics */}
        <div className="flex flex-col gap-3">
          <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
            <div className="text-xs sm:text-sm text-gray-400 mb-1">Watch Time</div>
            <div className="text-2xl sm:text-3xl font-bold text-white whitespace-nowrap">{formatDuration(stats.user.watch_duration || 0)}</div>
          </div>
          <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
            <div className="text-xs sm:text-sm text-gray-400 mb-1">Listen Time</div>
            <div className="text-2xl sm:text-3xl font-bold text-white whitespace-nowrap">{formatDuration(stats.user.listen_duration || 0)}</div>
          </div>
        </div>

        {/* Media Type Breakdown */}
        {stats.mediaTypes && stats.mediaTypes.length > 0 && (
          <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden w-fit max-w-full">
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-dark-700">
              <h3 className="text-sm sm:text-base font-semibold text-white">Media Type Breakdown</h3>
            </div>
            <div className="p-3">
              <div className="flex flex-wrap gap-2">
                {stats.mediaTypes.map((item) => (
                  <div key={item.media_type} className="bg-dark-700/50 rounded-lg p-2.5 border border-dark-600">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-primary-400">
                        {getMediaIcon(item.media_type)}
                      </div>
                      <span className="text-xs font-medium text-gray-300 capitalize">{item.media_type}</span>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-lg font-bold text-white whitespace-nowrap">{item.count} <span className="text-xs font-normal text-gray-400">plays</span></div>
                      <div className="text-xs text-gray-400 whitespace-nowrap">{formatDuration(item.total_duration || 0)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Server Usage (if multiple servers) */}
        {stats.serverBreakdown && stats.serverBreakdown.length > 1 && (
          <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden w-fit max-w-full">
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-dark-700">
              <h3 className="text-sm sm:text-base font-semibold text-white">Server Usage</h3>
            </div>
            <div className="p-3">
              <div className="flex flex-wrap gap-2">
                {stats.serverBreakdown.map((server) => (
                  <div key={server.server_type} className="bg-dark-700/50 rounded-lg p-2.5 border border-dark-600">
                    <div className="flex items-center gap-2 mb-1">
                      {getServerIcon(server.server_type)}
                      <span className="text-xs font-medium text-gray-300 capitalize">{server.server_type}</span>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-lg font-bold text-white whitespace-nowrap">{server.count} <span className="text-xs font-normal text-gray-400">plays</span></div>
                      <div className="text-xs text-gray-400 whitespace-nowrap">{formatDuration(server.total_duration || 0)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Top Locations */}
        {stats.topLocations && stats.topLocations.length > 0 && (
          <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden w-fit max-w-full">
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-dark-700">
              <h3 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Top Locations
              </h3>
            </div>
            <div className="p-3">
              <div className="flex flex-col gap-2">
                {stats.topLocations.map((location, index) => (
                  <div key={index} className="flex items-center justify-between gap-4 bg-dark-700/50 rounded-lg p-2.5 border border-dark-600">
                    <div className="flex items-center gap-2 min-w-0">
                      <MapPin className="w-4 h-4 text-primary-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {location.city}{location.region ? `, ${location.region}` : ''}
                        </div>
                        <div className="text-xs text-gray-500">{location.country}</div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-white whitespace-nowrap">{location.count}</div>
                      <div className="text-xs text-gray-400">{formatDuration(location.total_duration || 0)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Recent Activity */}
      {stats.recentWatches && stats.recentWatches.length > 0 && (
        <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden w-fit max-w-full">
          <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-dark-700">
            <h3 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary-400" />
              Activity
            </h3>
          </div>
          <div className="p-3">
            <div className="flex flex-wrap gap-2">
              {stats.recentWatches.map((watch, index) => (
                <div key={index} className="flex gap-2.5 p-2 bg-dark-700/30 rounded-lg border border-dark-600 hover:bg-dark-700/50 transition-colors w-[240px]">
                  {/* Thumbnail */}
                  {watch.thumb ? (
                    <div className="relative overflow-hidden rounded flex-shrink-0">
                      <img
                        src={`/proxy/image?url=${encodeURIComponent(watch.thumb)}`}
                        alt={watch.title}
                        className="w-9 h-12 sm:w-10 sm:h-14 object-cover"
                      />
                      <div className="absolute bottom-0.5 right-0.5 p-0.5 bg-black/80 rounded">
                        <div className="w-2.5 h-2.5 sm:w-3 sm:h-3">{getMediaIcon(watch.media_type)}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="w-9 h-12 sm:w-10 sm:h-14 bg-dark-600 rounded flex items-center justify-center text-gray-500 flex-shrink-0">
                      <div className="w-3.5 h-3.5 sm:w-4 sm:h-4">{getMediaIcon(watch.media_type)}</div>
                    </div>
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-medium text-white truncate">{watch.title}</h4>
                    {watch.parent_title && (
                      <p className="text-xs text-gray-400 truncate">{watch.parent_title}</p>
                    )}

                    {/* Meta Info */}
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-gray-500">
                      <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      <span className="truncate">{formatTimeAgo(watch.watched_at)}</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-1.5">
                      <div className="w-full h-1 bg-dark-600 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full"
                          style={{ width: `${watch.percent_complete}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserDetails;
