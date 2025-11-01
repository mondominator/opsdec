import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { Activity, Home, History, Users, Radio, Settings, PlayCircle, TrendingUp, Menu, ChevronDown, Clock } from 'lucide-react';
import { getDashboardStats } from '../utils/api';
import { formatDuration } from '../utils/format';

function Layout({ children }) {
  const location = useLocation();
  const [stats, setStats] = useState(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const navItems = [
    { path: '/', label: 'Dashboard', icon: Home },
    { path: '/activity', label: 'Current Activity', icon: Activity },
    { path: '/history', label: 'History', icon: History },
    { path: '/users', label: 'Users', icon: Users },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000); // Refresh every 10 seconds
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

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <div className="min-h-screen bg-dark-900">
      {/* Header */}
      <header className="bg-dark-850 border-b border-dark-700 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-1">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center space-x-1.5 hover:opacity-80 transition-opacity">
              <Radio className="w-4 h-4 text-primary-500" />
              <h1 className="text-sm font-bold text-white">OpsDec</h1>
            </Link>


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
                <div className="absolute right-0 mt-2 w-56 bg-dark-800 border border-dark-700 rounded-lg shadow-xl z-50">
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
