import { useEffect, useState } from 'react';
import { getActivity } from '../utils/api';
import { formatTimeAgo, formatDuration } from '../utils/format';
import { Activity as ActivityIcon, PlayCircle, Film, Tv, Headphones } from 'lucide-react';

function Activity() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const getServerIcon = (serverType) => {
    switch (serverType) {
      case 'emby':
        return <Film className="w-5 h-5 text-green-400" title="Emby" />;
      case 'plex':
        return <Tv className="w-5 h-5 text-yellow-400" title="Plex" />;
      case 'audiobookshelf':
        return <Headphones className="w-5 h-5 text-blue-400" title="Audiobookshelf" />;
      default:
        return null;
    }
  };

  useEffect(() => {
    loadActivity();
    const interval = setInterval(loadActivity, 3000); // Refresh every 3 seconds
    return () => clearInterval(interval);
  }, []);

  const loadActivity = async () => {
    try {
      const response = await getActivity();
      setSessions(response.data.data);
    } catch (error) {
      console.error('Error loading activity:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading activity...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sessions.length > 0 && (
        <div className="flex items-center space-x-2 text-gray-400 text-sm">
          <ActivityIcon className="w-4 h-4" />
          <span>{sessions.length} active {sessions.length === 1 ? 'stream' : 'streams'}</span>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-12">
            <PlayCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-400 mb-2">No Active Streams</h3>
            <p className="text-gray-500">No one is currently watching anything</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map((session) => (
            <div key={session.id} className="card">
              <div className="card-body">
                <div className="flex space-x-6">
                  {/* Thumbnail */}
                  <div className="flex-shrink-0 relative w-64 h-96 bg-dark-700 rounded-lg">
                    {session.thumb ? (
                      <img
                        src={`/proxy/image?url=${encodeURIComponent(session.thumb)}`}
                        alt={session.title}
                        className="w-full h-full object-contain rounded-lg"
                        loading="lazy"
                      />
                    ) : null}
                    <div
                      className="placeholder absolute inset-0 bg-dark-600 rounded-lg flex items-center justify-center"
                      style={{ display: session.thumb ? 'none' : 'flex' }}
                    >
                      <PlayCircle className="w-12 h-12 text-gray-500" />
                    </div>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-2xl font-bold text-white mb-1 truncate">
                          {session.title}
                        </h3>
                        {session.parent_title && (
                          <p className="text-lg text-gray-400 truncate">{session.parent_title}</p>
                        )}
                        {session.year && (
                          <p className="text-sm text-gray-500">{session.year}</p>
                        )}
                      </div>
                      <div className="ml-4">
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${
                            session.state === 'playing'
                              ? 'bg-green-500/20 text-green-400'
                              : session.state === 'paused'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {session.state.charAt(0).toUpperCase() + session.state.slice(1)}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {/* User info */}
                      <div className="flex items-center space-x-2 text-gray-400">
                        <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white font-medium text-sm">
                          {session.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium">{session.username}</span>
                        <span>•</span>
                        {getServerIcon(session.server_type)}
                        <span>•</span>
                        <span className="text-sm">{formatTimeAgo(session.started_at)}</span>
                      </div>

                      {/* Progress bar */}
                      <div>
                        <div className="flex justify-between text-sm text-gray-400 mb-2">
                          <span>{session.progress_percent}% complete</span>
                          {session.current_time && session.duration && (
                            <span>
                              {formatDuration(session.current_time)} / {formatDuration(session.duration)}
                            </span>
                          )}
                        </div>
                        <div className="bg-dark-600 rounded-full h-3">
                          <div
                            className="bg-primary-500 h-3 rounded-full transition-all duration-300"
                            style={{ width: `${session.progress_percent}%` }}
                          />
                        </div>
                      </div>

                      {/* Stream info */}
                      <div className="flex items-center flex-wrap gap-x-4 gap-y-2 text-sm">
                        <span className="text-gray-500 capitalize">{session.media_type}</span>
                        {session.bitrate && (
                          <>
                            <span className="text-gray-600">•</span>
                            <span className="text-primary-400 font-medium">{session.bitrate} Mbps</span>
                          </>
                        )}
                        {session.resolution && (
                          <>
                            <span className="text-gray-600">•</span>
                            <span className="text-gray-500">{session.resolution}</span>
                          </>
                        )}
                        {session.video_codec && (
                          <>
                            <span className="text-gray-600">•</span>
                            <span className="text-gray-500">{session.video_codec.toUpperCase()}</span>
                          </>
                        )}
                        {session.transcoding && (
                          <>
                            <span className="text-gray-600">•</span>
                            <span className="text-yellow-500">Transcoding</span>
                          </>
                        )}
                        {session.paused_counter > 0 && (
                          <>
                            <span className="text-gray-600">•</span>
                            <span className="text-gray-500">Paused {session.paused_counter} times</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Activity;
