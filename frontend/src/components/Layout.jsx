import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { Home, History, Users, Settings, Menu, ChevronDown, LogOut, Shield } from 'lucide-react';
import { getDashboardStats, getServerHealth } from '../utils/api';
import { formatDuration } from '../utils/format';
import { useAuth } from '../contexts/AuthContext';

function Layout({ children }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [stats, setStats] = useState(null);
  const [serverHealth, setServerHealth] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const handleLogout = async () => {
    setIsDropdownOpen(false);
    await logout();
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: Home },
    { path: '/history', label: 'History', icon: History },
    { path: '/users', label: 'Users', icon: Users },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  useEffect(() => {
    loadStats();
    loadServerHealth();
    const interval = setInterval(() => {
      loadStats();
      loadServerHealth();
    }, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);


  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadStats = async () => {
    try {
      const response = await getDashboardStats();
      setStats(response.data.data);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const loadServerHealth = async () => {
    try {
      const response = await getServerHealth();
      setServerHealth(response.data.data);
    } catch (error) {
      console.error('Error loading server health:', error);
    }
  };

  const getServerIcon = (serverType) => {
    switch (serverType) {
      case 'emby':
        return <img src="/logos/emby.svg" alt="Emby" className="w-3 h-3" />;
      case 'plex':
        return <img src="/logos/plex.svg" alt="Plex" className="w-3 h-3" />;
      case 'jellyfin':
        return <img src="/logos/jellyfin.svg" alt="Jellyfin" className="w-3 h-3" />;
      case 'audiobookshelf':
        return <img src="/logos/audiobookshelf.svg" alt="Audiobookshelf" className="w-3 h-3" />;
      case 'sappho':
        return <img src="/logos/sappho.png" alt="Sappho" className="w-3 h-3" />;
      default:
        return null;
    }
  };

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <div className="min-h-screen bg-dark-900">
      {/* Header */}
      <header className="bg-dark-850 border-b border-dark-700 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-1">
          <div className="flex items-center justify-between">
            {/* Logo - Icon only on mobile, icon + text on desktop */}
            <Link to="/" className="flex items-center hover:opacity-80 transition-opacity">
              <img src="/logo-icon.svg" alt="OpsDec" className="w-7 h-7 md:w-6 md:h-6" />
              <h1 className="hidden md:block text-sm font-bold ml-2">
                <span className="text-white">Ops</span>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">Dec</span>
              </h1>
            </Link>

            {/* Server Health Status - Touching on mobile, spaced on desktop */}
            {serverHealth.length > 0 && (
              <div className="flex items-center -space-x-px md:space-x-2">
                {serverHealth.map((server) => (
                  <div
                    key={server.id}
                    className="flex items-center space-x-1 px-2 py-1 rounded bg-dark-800 border border-dark-700 md:border-0"
                    title={`${server.name}: ${server.healthy ? 'Healthy' : 'Inactive'}`}
                  >
                    <div className={`flex items-center ${
                      server.type === 'emby' ? 'text-green-400' :
                      server.type === 'plex' ? 'text-yellow-400' :
                      server.type === 'jellyfin' ? 'text-purple-400' :
                      server.type === 'audiobookshelf' ? 'text-amber-600' :
                      server.type === 'sappho' ? 'text-blue-400' :
                      'text-gray-400'
                    }`}>
                      {getServerIcon(server.type)}
                    </div>
                    <div className={`w-2 h-2 rounded-full ${server.healthy ? 'bg-green-500' : 'bg-gray-600'}`} />
                  </div>
                ))}
              </div>
            )}

            {/* Navigation Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="nav-link flex items-center space-x-1 text-xs"
              >
                <Menu className="w-4 h-4" />
                <ChevronDown className={`w-3 h-3 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {isDropdownOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-dark-800 border border-dark-700 rounded-lg shadow-xl z-50">
                  {/* User Info */}
                  {user && (
                    <div className="px-4 py-3 border-b border-dark-700">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-white font-medium truncate">{user.username}</div>
                          {user.is_admin ? (
                            <div className="flex items-center gap-1 text-xs text-primary-400">
                              <Shield className="w-3 h-3" />
                              <span>Administrator</span>
                            </div>
                          ) : (
                            <div className="text-xs text-gray-500">User</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Navigation Links */}
                  <div className="py-2">
                    {navItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          onClick={() => setIsDropdownOpen(false)}
                          className={`flex items-center space-x-3 px-4 py-2.5 hover:bg-dark-700 transition-colors ${
                            isActive(item.path) ? 'bg-primary-500/10 text-primary-400' : 'text-gray-300'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>

                  {/* Statistics Section */}
                  {stats && (
                    <div className="px-4 py-3 border-t border-dark-700">
                      <div className="text-xs text-gray-400 mb-3 font-semibold">Statistics</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        <div>
                          <div className="text-gray-400">Total Users</div>
                          <div className="text-white font-semibold">{stats.totalUsers || 0}</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Watch Time</div>
                          <div className="text-white font-semibold">{formatDuration(stats.watchDuration || 0)}</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Listen Time</div>
                          <div className="text-white font-semibold">{formatDuration(stats.listenDuration || 0)}</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Monthly Avg</div>
                          <div className="text-white font-semibold">{stats.monthlyAverage || 0} plays</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Weekly Avg</div>
                          <div className="text-white font-semibold">{stats.weeklyAverage || 0} plays</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Daily Avg</div>
                          <div className="text-white font-semibold">{stats.dailyAverage || 0} plays</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Peak Day</div>
                          <div className="text-white font-semibold">{stats.peakDay || 'N/A'}</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Peak Hour</div>
                          <div className="text-white font-semibold">{stats.peakHour || 'N/A'}</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Monthly Active</div>
                          <div className="text-white font-semibold">{stats.activeMonthlyUsers || 0} users</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Logout */}
                  <div className="py-2 border-t border-dark-700">
                    <button
                      onClick={handleLogout}
                      className="flex items-center space-x-3 px-4 py-2.5 w-full text-left text-red-400 hover:bg-dark-700 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-dark-850 border-t border-dark-700 mt-auto">
        <div className="container mx-auto px-6 py-4">
          <p className="text-center text-gray-500 text-sm">
            OpsDec v0.1.0 - Media Server Monitoring
          </p>
        </div>
      </footer>
    </div>
  );
}

export default Layout;
