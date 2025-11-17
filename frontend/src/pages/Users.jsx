import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUsers } from '../utils/api';
import { formatTimeAgo, formatDuration } from '../utils/format';
import { Users as UsersIcon, Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

function Users() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('last_seen');
  const [sortOrder, setSortOrder] = useState('desc');

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

  const getServerIcon = (serverType) => {
    switch (serverType) {
      case 'emby':
        return <img src="/logos/emby.svg" alt="Emby" className="w-4 h-4" title="Emby" />;
      case 'plex':
        return <img src="/logos/plex.svg" alt="Plex" className="w-4 h-4" title="Plex" />;
      case 'audiobookshelf':
        return <img src="/logos/audiobookshelf.svg" alt="Audiobookshelf" className="w-4 h-4" title="Audiobookshelf" />;
      case 'sappho':
        return <img src="/logos/sappho.svg" alt="Sappho" className="w-4 h-4" title="Sappho" />;
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
        <>
          {/* Mobile View - Card Layout */}
          <div className="md:hidden space-y-3">
            {filteredUsers.map((user) => (
              <div
                key={user.id}
                onClick={() => navigate(`/users/${user.id}`)}
                className="card p-4 hover:border-primary-500 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 mb-3">
                  {user.thumb ? (
                    <img
                      src={`/proxy/image?url=${encodeURIComponent(user.thumb)}`}
                      alt={user.username}
                      className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-primary-600 rounded-full flex items-center justify-center text-white font-medium flex-shrink-0">
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white font-medium truncate">{user.username}</span>
                      {user.is_admin && (
                        <span className="text-xs bg-primary-500/20 text-primary-400 px-2 py-0.5 rounded flex-shrink-0">
                          Admin
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {user.is_mapped && user.server_types && user.server_types.length > 0 ? (
                        user.server_types.map((serverType, index) => (
                          <div key={index}>
                            {getServerIcon(serverType)}
                          </div>
                        ))
                      ) : !user.is_mapped && user.server_type ? (
                        getServerIcon(user.server_type)
                      ) : null}
                    </div>
                  </div>
                </div>
                {/* Watch/Listen Time in Row */}
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <div className="text-gray-500 text-xs">Watch</div>
                    <div className="text-white">{formatDuration(user.watch_duration || 0)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">Listen</div>
                    <div className="text-white">{formatDuration(user.listen_duration || 0)}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-gray-500 text-xs">Last Seen</div>
                    <div className="text-gray-300 text-xs">{formatTimeAgo(user.last_seen)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop View - Table */}
          <div className="hidden md:block card">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-dark-700">
                  <tr>
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700">
                  {filteredUsers.map((user) => (
                    <tr
                      key={user.id}
                      onClick={() => navigate(`/users/${user.id}`)}
                      className="hover:bg-dark-700/50 transition-colors cursor-pointer"
                    >
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
                              <span className="text-white font-medium hover:text-primary-400 transition-colors">
                                {user.username}
                              </span>
                              {user.is_mapped && user.server_types && user.server_types.length > 0 ? (
                                user.server_types.map((serverType, index) => (
                                  <div key={index}>
                                    {getServerIcon(serverType)}
                                  </div>
                                ))
                              ) : !user.is_mapped && user.server_type ? (
                                getServerIcon(user.server_type)
                              ) : null}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default Users;
