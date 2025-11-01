import { useEffect, useState } from 'react';
import { getHistory } from '../utils/api';
import { formatTimestamp, formatMediaType, formatDuration } from '../utils/format';
import { History as HistoryIcon, PlayCircle } from 'lucide-react';

function History() {
  const [history, setHistory] = useState([]);
  const [pagination, setPagination] = useState({ limit: 50, offset: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, [pagination.offset]);

  const loadHistory = async () => {
    try {
      const response = await getHistory({ limit: pagination.limit, offset: pagination.offset });
      setHistory(response.data.data);
      setPagination((prev) => ({ ...prev, total: response.data.pagination.total }));
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setLoading(false);
    }
  };

  const nextPage = () => {
    setPagination((prev) => ({ ...prev, offset: prev.offset + prev.limit }));
  };

  const prevPage = () => {
    setPagination((prev) => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading history...</div>
      </div>
    );
  }

  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <div className="space-y-6">
      {pagination.total > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-400">
            {pagination.total} total plays
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-12">
            <HistoryIcon className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-400 mb-2">No History</h3>
            <p className="text-gray-500">No playback history found</p>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-dark-700">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Media</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">User</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Type</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Progress</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Time Spent</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Watched / Listened</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700">
                  {history.map((item) => (
                    <tr key={item.id} className="hover:bg-dark-700/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-4">
                          <div className="flex-shrink-0">
                            {item.thumb ? (
                              <img
                                src={item.thumb}
                                alt={item.title}
                                className="w-12 h-16 object-cover rounded"
                              />
                            ) : (
                              <div className="w-12 h-16 bg-dark-600 rounded flex items-center justify-center">
                                <PlayCircle className="w-6 h-6 text-gray-500" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-white font-medium truncate">{item.title}</div>
                            {item.parent_title && (
                              <div className="text-sm text-gray-400 truncate">{item.parent_title}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          {item.user_thumb ? (
                            <img
                              src={`/proxy/image?url=${encodeURIComponent(item.user_thumb)}`}
                              alt={item.username}
                              className="w-8 h-8 rounded-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white font-medium text-xs">
                              {item.username.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-gray-300">{item.username}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-gray-300">{formatMediaType(item.media_type)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-24 bg-dark-600 rounded-full h-2">
                            <div
                              className="bg-primary-500 h-2 rounded-full"
                              style={{ width: `${item.percent_complete}%` }}
                            />
                          </div>
                          <span className="text-sm text-gray-400">{item.percent_complete}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-gray-400 text-sm">{formatDuration(item.session_duration)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-gray-400 text-sm">{formatTimestamp(item.watched_at)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-400">
                Showing {pagination.offset + 1} - {Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={prevPage}
                  disabled={pagination.offset === 0}
                  className="btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <div className="flex items-center space-x-2 px-4">
                  <span className="text-gray-400">
                    Page {currentPage} of {totalPages}
                  </span>
                </div>
                <button
                  onClick={nextPage}
                  disabled={pagination.offset + pagination.limit >= pagination.total}
                  className="btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default History;
