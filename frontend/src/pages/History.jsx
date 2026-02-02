import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHistory, deleteHistoryItem } from '../utils/api';
import { formatTimestamp, formatMediaType, formatDuration } from '../utils/format';
import { History as HistoryIcon, PlayCircle, Search, Filter, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Trash2, Book } from 'lucide-react';
import { useTimezone } from '../contexts/TimezoneContext';

// Thumbnail component with error handling - shows placeholder on load failure
function MediaThumbnail({ src, alt, title, serverType, className = "w-12 h-16" }) {
  const [hasError, setHasError] = useState(false);

  const imgSrc = src ? `/proxy/image?url=${encodeURIComponent(src)}` : null;

  if (hasError || !src) {
    // Show placeholder with first letter of title
    return (
      <div className={`${className} bg-gradient-to-br from-dark-600 to-dark-700 rounded flex items-center justify-center border border-dark-500`}>
        {serverType === 'audiobookshelf' ? (
          <Book className="w-6 h-6 text-gray-500" />
        ) : (
          <span className="text-gray-400 font-bold text-lg">
            {title?.charAt(0)?.toUpperCase() || '?'}
          </span>
        )}
      </div>
    );
  }

  // Use object-contain for audiobooks (typically square covers) to avoid cropping
  const isAudiobook = serverType === 'audiobookshelf' || serverType === 'sappho';
  const objectFit = isAudiobook ? 'object-contain' : 'object-cover';

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={`${className} ${objectFit} rounded`}
      onError={() => setHasError(true)}
    />
  );
}

const getServerIcon = (serverType) => {
  switch (serverType) {
    case 'emby':
      return <img src="/logos/emby.svg" alt="Emby" className="w-5 h-5" title="Emby" />;
    case 'plex':
      return <img src="/logos/plex.svg" alt="Plex" className="w-5 h-5" title="Plex" />;
    case 'jellyfin':
      return <img src="/logos/jellyfin.svg" alt="Jellyfin" className="w-5 h-5" title="Jellyfin" />;
    case 'audiobookshelf':
      return <img src="/logos/audiobookshelf.svg" alt="Audiobookshelf" className="w-5 h-5" title="Audiobookshelf" />;
    case 'sappho':
      return <img src="/logos/sappho.png" alt="Sappho" className="w-5 h-5" title="Sappho" />;
    default:
      return null;
  }
};

function History() {
  const navigate = useNavigate();
  const { timezone } = useTimezone(); // This will cause re-render when timezone changes
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
  const [mediaColumnWidth, setMediaColumnWidth] = useState(448); // Default to max-w-md (28rem = 448px)

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
        case 'stream_duration':
          aVal = a.stream_duration || 0;
          bVal = b.stream_duration || 0;
          break;
        case 'watched_at':
          aVal = a.watched_at || 0;
          bVal = b.watched_at || 0;
          break;
        case 'location':
          aVal = a.city?.toLowerCase() || a.ip_address || '';
          bVal = b.city?.toLowerCase() || b.ip_address || '';
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

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this history entry?')) {
      return;
    }

    try {
      await deleteHistoryItem(id);
      // Remove from local state
      setAllHistory(prev => prev.filter(item => item.id !== id));
    } catch (error) {
      console.error('Error deleting history item:', error);
      alert('Failed to delete history item');
    }
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

  const formatLocation = (item) => {
    if (item.city === 'Local Network') {
      return 'Local Network';
    } else if (item.city) {
      return `${item.city}${item.region ? `, ${item.region}` : ''}`;
    } else if (item.ip_address) {
      return item.ip_address;
    }
    return '-';
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
              <label className="block text-sm text-gray-400 mb-1">
                Type
                <span className="ml-2 text-gray-500">
                  ({filteredHistory.length} of {allHistory.length})
                </span>
              </label>
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
            <div className="flex justify-start items-center">
              <button
                onClick={clearFilters}
                className="text-sm text-primary-500 hover:text-primary-400"
              >
                Clear all filters
              </button>
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
          {/* Mobile View - Card Layout */}
          <div className="md:hidden space-y-3">
            {paginatedHistory.map((item) => (
              <div key={item.id} className="card p-4">
                <div className="flex gap-3 mb-3">
                  {/* Thumbnail */}
                  <div className="flex-shrink-0">
                    <MediaThumbnail
                      src={item.thumb}
                      alt={item.title}
                      title={item.title}
                      serverType={item.server_type}
                      className="w-12 h-16"
                    />
                  </div>

                  {/* Title and User */}
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-medium text-sm mb-1 line-clamp-2">{item.title}</div>
                    {item.parent_title && (
                      <div className="text-xs text-gray-400 mb-2 truncate">{item.parent_title}</div>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      {item.user_thumb ? (
                        <img
                          src={`/proxy/image?url=${encodeURIComponent(item.user_thumb)}`}
                          alt={item.username}
                          className="w-5 h-5 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-5 h-5 bg-primary-600 rounded-full flex items-center justify-center text-white text-xs">
                          {item.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-xs text-gray-300 truncate">{item.username}</span>
                    </div>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="flex-shrink-0 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors h-fit"
                    title="Delete entry"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Progress Bar */}
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 bg-dark-600 rounded-full h-1.5">
                      <div
                        className="bg-primary-500 h-1.5 rounded-full"
                        style={{ width: `${item.percent_complete}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400">{item.percent_complete}%</span>
                  </div>
                </div>

                {/* Metadata Row */}
                <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                  <div className="flex items-center gap-1">
                    {getServerIcon(item.server_type)}
                  </div>
                  <span className="capitalize">{formatMediaType(item.media_type)}</span>
                  <span>•</span>
                  <span>{item.stream_duration ? formatDuration(item.stream_duration) : '-'}</span>
                  <span>•</span>
                  <span>{formatLocation(item)}</span>
                  <div className="w-full text-gray-500 mt-1">{formatTimestamp(item.watched_at)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop View - Table */}
          <div className="hidden md:block card">
            <div>
              <table className="w-full table-fixed">
                <thead className="bg-dark-700">
                  <tr>
                    <th
                      className="px-6 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors relative w-[30%]"
                      onClick={() => handleSort('title')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Media</span>
                        {getSortIcon('title')}
                      </div>
                    </th>
                    <th
                      className="px-4 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors w-[12%]"
                      onClick={() => handleSort('username')}
                    >
                      <div className="flex items-center gap-2">
                        <span>User</span>
                        {getSortIcon('username')}
                      </div>
                    </th>
                    <th
                      className="px-4 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors w-[8%]"
                      onClick={() => handleSort('server_type')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Server</span>
                        {getSortIcon('server_type')}
                      </div>
                    </th>
                    <th
                      className="px-4 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors w-[10%]"
                      onClick={() => handleSort('media_type')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Type</span>
                        {getSortIcon('media_type')}
                      </div>
                    </th>
                    <th
                      className="px-4 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors w-[8%]"
                      onClick={() => handleSort('percent_complete')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Progress</span>
                        {getSortIcon('percent_complete')}
                      </div>
                    </th>
                    <th
                      className="px-4 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors w-[10%]"
                      onClick={() => handleSort('stream_duration')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Duration</span>
                        {getSortIcon('stream_duration')}
                      </div>
                    </th>
                    <th
                      className="px-4 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors w-[10%]"
                      onClick={() => handleSort('location')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Location</span>
                        {getSortIcon('location')}
                      </div>
                    </th>
                    <th
                      className="px-4 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors w-[10%]"
                      onClick={() => handleSort('watched_at')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Timestamp</span>
                        {getSortIcon('watched_at')}
                      </div>
                    </th>
                    <th className="px-4 py-4 text-center text-sm font-semibold text-gray-300 w-[8%]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700">
                  {paginatedHistory.map((item) => (
                    <tr key={item.id} className="hover:bg-dark-700/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-4">
                          <div className="flex-shrink-0">
                            <MediaThumbnail
                              src={item.thumb}
                              alt={item.title}
                              title={item.title}
                              serverType={item.server_type}
                              className="w-12 h-16"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-white font-medium truncate">{item.title}</div>
                            {item.parent_title && (
                              <div className="text-sm text-gray-400 truncate">{item.parent_title}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div
                          className="flex items-center space-x-2 cursor-pointer group"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/users/${item.user_id}`);
                          }}
                        >
                          {item.user_thumb ? (
                            <img
                              src={`/proxy/image?url=${encodeURIComponent(item.user_thumb)}`}
                              alt={item.username}
                              className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white font-medium text-xs flex-shrink-0">
                              {item.username.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-gray-300 group-hover:text-primary-400 transition-colors truncate">
                            {item.username}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-center">
                          {getServerIcon(item.server_type)}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-gray-300 text-sm truncate">{formatMediaType(item.media_type)}</span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center space-x-2">
                          <div className="flex-1 bg-dark-600 rounded-full h-2 min-w-0">
                            <div
                              className="bg-primary-500 h-2 rounded-full"
                              style={{ width: `${item.percent_complete}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0">{item.percent_complete}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-gray-400 text-sm truncate block">
                          {item.stream_duration ? formatDuration(item.stream_duration) : '-'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-gray-400 text-sm truncate block">{formatLocation(item)}</span>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-gray-400 text-sm truncate block">{formatTimestamp(item.watched_at)}</span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-center">
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                            title="Delete entry"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
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
