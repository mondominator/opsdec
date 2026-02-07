import { createContext, useContext, useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import axios from 'axios';

const AuthContext = createContext(null);

// Storage keys for backwards compatibility during transition
const TOKEN_STORAGE_KEY = 'opsdec_access_token';
const REFRESH_TOKEN_STORAGE_KEY = 'opsdec_refresh_token';

// Configure axios to send cookies with requests
axios.defaults.withCredentials = true;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const initialized = useRef(false);

  // Clear any legacy localStorage tokens (migration cleanup)
  const clearLegacyTokens = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  };

  // Check if setup is required (no users exist)
  const checkSetupRequired = async () => {
    try {
      const response = await axios.get('/api/auth/setup-required');
      return response.data.setupRequired;
    } catch (error) {
      console.error('Error checking setup status:', error);
      return false;
    }
  };

  // Login - cookies are set automatically by the server
  const login = async (username, password) => {
    const response = await api.post('/auth/login', { username, password });
    const { user: userData } = response.data;

    // Clear any legacy localStorage tokens
    clearLegacyTokens();
    setUser(userData);
    setSetupRequired(false);

    return userData;
  };

  // Register (for first user setup) - cookies are set automatically by the server
  const register = async (username, password, email) => {
    const response = await api.post('/auth/register', { username, password, email });
    const { user: userData } = response.data;

    // Clear any legacy localStorage tokens
    clearLegacyTokens();
    setUser(userData);
    setSetupRequired(false);

    return userData;
  };

  // Logout - server clears the cookies
  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      // Clear any legacy localStorage tokens
      clearLegacyTokens();
      setUser(null);
    }
  };

  // Fetch current user info - uses api instance which has token refresh interceptor
  const fetchUser = async () => {
    try {
      const response = await api.get('/auth/me');
      setUser(response.data.user);
      return response.data.user;
    } catch (error) {
      // 401 is expected if not logged in
      if (error.response?.status !== 401) {
        console.error('Error fetching user:', error);
      }
      setUser(null);
      return null;
    }
  };

  // Initialize auth state on mount - only once
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const initAuth = async () => {
      try {
        // First check if setup is required
        const needsSetup = await checkSetupRequired();
        setSetupRequired(needsSetup);

        if (needsSetup) {
          setLoading(false);
          return;
        }

        // Try to restore session from HTTP-only cookies (sent automatically)
        await fetchUser();
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  const value = {
    user,
    loading,
    setupRequired,
    login,
    register,
    logout,
    fetchUser,
    checkSetupRequired
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
