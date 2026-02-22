import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { Home, History, Users, Settings, Menu, ChevronDown, LogOut, Shield, Play, Film, Headphones, TrendingUp } from 'lucide-react';
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

  const serverTypeOrder = { plex: 0, emby: 1, jellyfin: 2, audiobookshelf: 3, sappho: 4 };
  const sortedServerHealth = [...serverHealth].sort((a, b) => (serverTypeOrder[a.type] ?? 9) - (serverTypeOrder[b.type] ?? 9));

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <div className="min-h-screen bg-dark-900">
      {/* Header */}
      <header className="bg-dark-850 border-b border-dark-700 sticky top-0 z-50">
        <div className="mx-auto px-4 py-1 max-w-[1600px]">
          <div className="flex items-center justify-between">
            {/* Logo - Icon only on mobile, icon + text on desktop */}
            <Link to="/" className="flex items-center hover:opacity-80 transition-opacity">
              <img src="/logo-icon.svg" alt="OpsDec" className="w-7 h-7 md:w-6 md:h-6" />
              <h1 className="hidden md:block text-sm font-bold ml-2">
                <span className="text-white">Ops</span>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">Dec</span>
              </h1>
            </Link>

            {/* Stats Strip + Server Health */}
            {stats && (
              <div className="hidden md:flex items-center gap-x-5">
                <div className="flex items-center gap-1.5">
                  <Play className="w-3 h-3 text-gray-500" />
                  <span className="text-[11px] text-gray-400">Today</span>
                  <span className="text-xs font-bold text-white">{stats.dailyAverage ?? 0}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Film className="w-3 h-3 text-gray-500" />
                  <span className="text-[11px] text-gray-400">Watch</span>
                  <span className="text-xs font-bold text-white">{formatDuration(stats.watchDuration)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Headphones className="w-3 h-3 text-gray-500" />
                  <span className="text-[11px] text-gray-400">Listen</span>
                  <span className="text-xs font-bold text-white">{formatDuration(stats.listenDuration)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Users className="w-3 h-3 text-gray-500" />
                  <span className="text-[11px] text-gray-400">Users</span>
                  <span className="text-xs font-bold text-white">{stats.activeMonthlyUsers ?? 0}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3 text-gray-500" />
                  <span className="text-[11px] text-gray-400">Avg/day</span>
                  <span className="text-xs font-bold text-white">{stats.weeklyAverage ?? 0}</span>
                </div>
                {serverHealth.length > 0 && (
                  <div className="flex items-center gap-2 ml-1 pl-4 border-l border-dark-700">
                    {sortedServerHealth.map((server) => (
                      <div key={server.id} className="flex items-center gap-1" title={`${server.name}: ${server.healthy ? 'Healthy' : server.enabled ? 'Unreachable' : 'Disabled'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${server.healthy ? 'bg-green-500' : server.enabled ? 'bg-red-500' : 'bg-gray-600'}`} />
                        {getServerIcon(server.type)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Mobile: just server health dots */}
            {serverHealth.length > 0 && (
              <div className="flex md:hidden items-center gap-2">
                {sortedServerHealth.map((server) => (
                  <div key={server.id} className="flex items-center gap-1" title={`${server.name}: ${server.healthy ? 'Healthy' : 'Inactive'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${server.healthy ? 'bg-green-500' : server.enabled ? 'bg-red-500' : 'bg-gray-600'}`} />
                    {getServerIcon(server.type)}
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
      <main className="mx-auto px-6 pt-3 pb-8 max-w-[1600px]">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-dark-850 border-t border-dark-700 mt-auto">
        <div className="mx-auto px-6 py-4 max-w-[1600px]">
          <p className="text-center text-gray-500 text-sm">
            OpsDec v0.1.0 - Media Server Monitoring
          </p>
        </div>
      </footer>
    </div>
  );
}

export default Layout;
