import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUsers } from '../utils/api';
import { formatTimeAgo, formatDuration } from '../utils/format';
import { Users as UsersIcon, Search, ChevronRight, ChevronDown, Film, Tv, Headphones, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

function Users() {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('last_seen');
  const [sortOrder, setSortOrder] = useState('desc');
  const [expandedRows, setExpandedRows] = useState(new Set());

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    filterAndSortUsers();
  }, [users, searchTerm, sortBy, sortOrder]);

  const loadUsers = async () => {
    try {
      const response = await getUsers();
      setUsers(response.data.data);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterAndSortUsers = () => {
    let filtered = users;

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(user =>
        user.username.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Apply sorting
    filtered = [...filtered].sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];

      // Handle username (string) sorting
      if (sortBy === 'username') {
        aVal = (aVal || '').toLowerCase();
        bVal = (bVal || '').toLowerCase();
      } else {
        // Handle null values for numeric fields
        if (aVal === null || aVal === undefined) aVal = 0;
        if (bVal === null || bVal === undefined) bVal = 0;
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });

    setFilteredUsers(filtered);
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const toggleRow = (userId) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(userId)) {
      newExpanded.delete(userId);
    } else {
      newExpanded.add(userId);
    }
    setExpandedRows(newExpanded);
  };

  const getServerIcon = (serverType) => {
    switch (serverType) {
      case 'emby':
        return <img src="/logos/emby.svg" alt="Emby" className="w-4 h-4" title="Emby" />;
      case 'plex':
        return <img src="/logos/plex.svg" alt="Plex" className="w-4 h-4" title="Plex" />;
      case 'audiobookshelf':
        return <img src="/logos/audiobookshelf.svg" alt="Audiobookshelf" className="w-4 h-4" title="Audiobookshelf" />;
      default:
        return null;
    }
  };

  const getSortIcon = (field) => {
    if (sortBy !== field) {
      return <ArrowUpDown className="w-4 h-4 text-gray-500" />;
    }
    return sortOrder === 'asc'
      ? <ArrowUp className="w-4 h-4 text-primary-500" />
      : <ArrowDown className="w-4 h-4 text-primary-500" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading users...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with search and count */}
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-gray-400">
          {filteredUsers.length} {filteredUsers.length === users.length ? 'total' : `of ${users.length}`} users
        </div>

        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
          />
        </div>
      </div>

      {filteredUsers.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-12">
            <UsersIcon className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-400 mb-2">
              {searchTerm ? 'No Users Found' : 'No Users'}
            </h3>
            <p className="text-gray-500">
              {searchTerm ? 'Try adjusting your search' : 'No user data available'}
            </p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-dark-700">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300 w-8">
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
                    onClick={() => handleSort('watch_duration')}
                  >
                    <div className="flex items-center gap-2">
                      <span>Watch Time</span>
                      {getSortIcon('watch_duration')}
                    </div>
                  </th>
                  <th
                    className="px-6 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors"
                    onClick={() => handleSort('listen_duration')}
                  >
                    <div className="flex items-center gap-2">
                      <span>Listen Time</span>
                      {getSortIcon('listen_duration')}
                    </div>
                  </th>
                  <th
                    className="px-6 py-4 text-left text-sm font-semibold text-gray-300 cursor-pointer hover:bg-dark-600 transition-colors"
                    onClick={() => handleSort('last_seen')}
                  >
                    <div className="flex items-center gap-2">
                      <span>Last Seen</span>
                      {getSortIcon('last_seen')}
                    </div>
                  </th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {filteredUsers.map((user) => (
                  <>
                    <tr key={user.id} className="hover:bg-dark-700/50 transition-colors">
                      <td className="px-6 py-4">
                        <button
                          onClick={() => toggleRow(user.id)}
                          className="text-gray-400 hover:text-white transition-colors"
                        >
                          <ChevronDown
                            className={`w-4 h-4 transition-transform ${
                              expandedRows.has(user.id) ? 'rotate-0' : '-rotate-90'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          {user.thumb ? (
                            <img
                              src={`/proxy/image?url=${encodeURIComponent(user.thumb)}`}
                              alt={user.username}
                              className="w-10 h-10 rounded-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-10 h-10 bg-primary-600 rounded-full flex items-center justify-center text-white font-medium text-sm">
                              {user.username.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="text-white font-medium">{user.username}</span>
                              {user.is_admin ? (
                                <span className="text-xs bg-primary-500/20 text-primary-400 px-2 py-0.5 rounded">
                                  Admin
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-gray-300">{formatDuration(user.watch_duration || 0)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-gray-300">{formatDuration(user.listen_duration || 0)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-gray-300">{formatTimeAgo(user.last_seen)}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          to={`/users/${user.id}`}
                          className="inline-flex items-center text-primary-400 hover:text-primary-300 transition-colors"
                        >
                          Details
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Link>
                      </td>
                    </tr>
                    {expandedRows.has(user.id) && user.server_stats && user.server_stats.length > 0 && (
                      <tr key={`${user.id}-expanded`} className="bg-dark-800/50">
                        <td colSpan="8" className="px-6 py-4">
                          <div className="ml-14">
                            <h4 className="text-sm font-semibold text-gray-300 mb-3">Server Breakdown</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              {user.server_stats.map((stat) => (
                                <div key={stat.server_type} className="bg-dark-700 rounded-lg p-4">
                                  <div className="flex items-center space-x-2 mb-2">
                                    {getServerIcon(stat.server_type)}
                                    <span className="text-white font-medium capitalize">{stat.server_type}</span>
                                  </div>
                                  <div className="space-y-1 text-sm">
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Plays:</span>
                                      <span className="text-gray-300">{stat.plays}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Duration:</span>
                                      <span className="text-gray-300">{formatDuration(stat.duration)}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default Users;
