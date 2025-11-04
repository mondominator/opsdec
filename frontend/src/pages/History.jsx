import { useEffect, useState } from 'react';
import { getHistory } from '../utils/api';
import { formatTimestamp, formatMediaType, formatDuration } from '../utils/format';
import { History as HistoryIcon, PlayCircle, Search, Filter, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

const getServerIcon = (serverType) => {
  switch (serverType) {
    case 'emby':
      return <img src="/logos/emby.svg" alt="Emby" className="w-5 h-5" title="Emby" />;
    case 'plex':
      return <img src="/logos/plex.svg" alt="Plex" className="w-5 h-5" title="Plex" />;
    case 'audiobookshelf':
      return <img src="/logos/audiobookshelf.svg" alt="Audiobookshelf" className="w-5 h-5" title="Audiobookshelf" />;
    default:
      return null;
  }
};

function History() {
  const [allHistory, setAllHistory] = useState([]);
  const [filteredHistory, setFilteredHistory] = useState([]);
  const [pagination, setPagination] = useState({ limit: 50, offset: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterServer, setFilterServer] = useState('');
  const [filterType, setFilterType] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [sortField, setSortField] = useState('watched_at');
  const [sortDirection, setSortDirection] = useState('desc');

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [allHistory, searchTerm, filterUser, filterServer, filterType, sortField, sortDirection]);

  useEffect(() => {
    setPagination(prev => ({ ...prev, limit: itemsPerPage, offset: 0 }));
  }, [itemsPerPage]);

  const loadHistory = async () => {
    try {
      // Load all history for client-side filtering
      const response = await getHistory({ limit: 10000, offset: 0 });
      setAllHistory(response.data.data);
      setPagination((prev) => ({ ...prev, total: response.data.data.length }));
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...allHistory];

    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(item =>
        item.title?.toLowerCase().includes(search) ||
        item.parent_title?.toLowerCase().includes(search) ||
        item.username?.toLowerCase().includes(search)
      );
    }

    // User filter
    if (filterUser) {
      filtered = filtered.filter(item => item.username === filterUser);
    }

    // Server filter
    if (filterServer) {
      filtered = filtered.filter(item => item.server_type === filterServer);
    }

    // Type filter
    if (filterType) {
      filtered = filtered.filter(item => item.media_type === filterType);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aVal, bVal;

      switch (sortField) {
        case 'title':
          aVal = a.title?.toLowerCase() || '';
          bVal = b.title?.toLowerCase() || '';
          break;
        case 'username':
          aVal = a.username?.toLowerCase() || '';
          bVal = b.username?.toLowerCase() || '';
          break;
        case 'server_type':
          aVal = a.server_type?.toLowerCase() || '';
          bVal = b.server_type?.toLowerCase() || '';
          break;
        case 'media_type':
          aVal = a.media_type?.toLowerCase() || '';
          bVal = b.media_type?.toLowerCase() || '';
          break;
        case 'percent_complete':
          aVal = a.percent_complete || 0;
          bVal = b.percent_complete || 0;
          break;
        case 'session_duration':
          aVal = a.session_duration || 0;
          bVal = b.session_duration || 0;
          break;
        case 'watched_at':
          aVal = a.watched_at || 0;
          bVal = b.watched_at || 0;
          break;
        default:
          return 0;
      }

      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });

    setFilteredHistory(filtered);
    setPagination(prev => ({ ...prev, total: filtered.length, offset: 0 }));
  };

  const nextPage = () => {
    setPagination((prev) => ({
      ...prev,
      offset: Math.min(prev.offset + prev.limit, prev.total - prev.limit)
    }));
  };

  const prevPage = () => {
    setPagination((prev) => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }));
  };

  const goToPage = (pageNum) => {
    setPagination(prev => ({ ...prev, offset: (pageNum - 1) * prev.limit }));
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterUser('');
    setFilterServer('');
    setFilterType('');
  };

  const handleSort = (field) => {
    if (sortField === field) {
      // Toggle direction if clicking the same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new field and default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-4 h-4 text-gray-500" />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="w-4 h-4 text-primary-500" />
      : <ArrowDown className="w-4 h-4 text-primary-500" />;
  };

  // Get unique values for filters
  const uniqueUsers = [...new Set(allHistory.map(item => item.username))].sort();
  const uniqueServers = [...new Set(allHistory.map(item => item.server_type))].sort();
  const uniqueTypes = [...new Set(allHistory.map(item => item.media_type))]
    .filter(type => type !== 'video')
    .sort();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading history...</div>
      </div>
    );
  }

  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const paginatedHistory = filteredHistory.slice(pagination.offset, pagination.offset + pagination.limit);

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

    if (endPage - startPage < maxPagesToShow - 1) {
      startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }
    return pages;
  };

  const hasActiveFilters = searchTerm || filterUser || filterServer || filterType;

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="card">
        <div className="card-body space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by title, show name, or username..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500"
            />
          </div>

          {/* Filters Row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* User Filter */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">User</label>
              <select
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
              >
                <option value="">All Users</option>
                {uniqueUsers.map(user => (
                  <option key={user} value={user}>{user}</option>
                ))}
              </select>
            </div>

            {/* Server Filter */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Server</label>
              <select
                value={filterServer}
                onChange={(e) => setFilterServer(e.target.value)}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
              >
                <option value="">All Servers</option>
                {uniqueServers.map(server => (
                  <option key={server} value={server}>{server.charAt(0).toUpperCase() + server.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* Type Filter */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Type</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
              >
                <option value="">All Types</option>
                {uniqueTypes.map(type => (
                  <option key={type} value={type}>{formatMediaType(type)}</option>
                ))}
              </select>
            </div>

            {/* Items Per Page */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Items per page</label>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
              </select>
            </div>
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <div className="flex justify-between items-center">
              <button
                onClick={clearFilters}
                className="text-sm text-primary-500 hover:text-primary-400"
              >
                Clear all filters
              </button>
              <div className="text-sm text-gray-400">
                Showing {filteredHistory.length} of {allHistory.length} total plays
              </div>
            </div>
          )}
        </div>
      </div>

      {paginatedHistory.length === 0 ? (
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
                    <th
                      className="px-6 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors"
                      onClick={() => handleSort('title')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Media</span>
                        {getSortIcon('title')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors"
                      onClick={() => handleSort('username')}
                    >
                      <div className="flex items-center gap-2">
                        <span>User</span>
                        {getSortIcon('username')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors"
                      onClick={() => handleSort('server_type')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Server</span>
                        {getSortIcon('server_type')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors"
                      onClick={() => handleSort('media_type')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Type</span>
                        {getSortIcon('media_type')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors"
                      onClick={() => handleSort('percent_complete')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Progress</span>
                        {getSortIcon('percent_complete')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors"
                      onClick={() => handleSort('session_duration')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Time Spent</span>
                        {getSortIcon('session_duration')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors"
                      onClick={() => handleSort('watched_at')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Watched / Listened</span>
                        {getSortIcon('watched_at')}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700">
                  {paginatedHistory.map((item) => (
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
                        <div className="flex items-center justify-center">
                          {getServerIcon(item.server_type)}
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
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-sm text-gray-400">
                Showing {pagination.offset + 1} - {Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={prevPage}
                  disabled={pagination.offset === 0}
                  className="p-2 rounded-lg bg-dark-700 border border-dark-600 text-gray-300 hover:bg-dark-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                {/* Page Numbers */}
                <div className="flex gap-1">
                  {getPageNumbers().map(pageNum => (
                    <button
                      key={pageNum}
                      onClick={() => goToPage(pageNum)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        pageNum === currentPage
                          ? 'bg-primary-600 text-white'
                          : 'bg-dark-700 border border-dark-600 text-gray-300 hover:bg-dark-600'
                      }`}
                    >
                      {pageNum}
                    </button>
                  ))}
                </div>

                <button
                  onClick={nextPage}
                  disabled={pagination.offset + pagination.limit >= pagination.total}
                  className="p-2 rounded-lg bg-dark-700 border border-dark-600 text-gray-300 hover:bg-dark-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Next page"
                >
                  <ChevronRight className="w-5 h-5" />
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
