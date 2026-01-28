import { createContext, useContext, useState, useEffect, useRef } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const TOKEN_STORAGE_KEY = 'opsdec_access_token';
const REFRESH_TOKEN_STORAGE_KEY = 'opsdec_refresh_token';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const initialized = useRef(false);

  // Get stored tokens
  const getStoredTokens = () => {
    return {
      accessToken: localStorage.getItem(TOKEN_STORAGE_KEY),
      refreshToken: localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)
    };
  };

  // Store tokens
  const storeTokens = (accessToken, refreshToken) => {
    if (accessToken) {
      localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
    }
    if (refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
    }
  };

  // Clear tokens
  const clearTokens = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  };

  // Get a valid access token (refreshing if needed)
  const getAccessToken = async () => {
    const { accessToken, refreshToken } = getStoredTokens();

    if (!accessToken || !refreshToken) {
      return null;
    }

    // Try to use existing token first
    try {
      // Check if token is expired by decoding it
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      const expiresAt = payload.exp * 1000;

      // If token expires in more than 1 minute, use it
      if (expiresAt > Date.now() + 60000) {
        return accessToken;
      }
    } catch (e) {
      // Token is malformed, try to refresh
    }

    // Token is expired or about to expire, try to refresh
    try {
      const response = await axios.post('/api/auth/refresh', { refreshToken });
      const newAccessToken = response.data.accessToken;
      storeTokens(newAccessToken, null);
      return newAccessToken;
    } catch (error) {
      // Refresh failed, clear tokens
      clearTokens();
      setUser(null);
      return null;
    }
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

  // Login
  const login = async (username, password) => {
    const response = await axios.post('/api/auth/login', { username, password });
    const { user: userData, accessToken, refreshToken } = response.data;

    storeTokens(accessToken, refreshToken);
    setUser(userData);
    setSetupRequired(false);

    return userData;
  };

  // Register (for first user setup)
  const register = async (username, password, email) => {
    const response = await axios.post('/api/auth/register', { username, password, email });
    const { user: userData, accessToken, refreshToken } = response.data;

    storeTokens(accessToken, refreshToken);
    setUser(userData);
    setSetupRequired(false);

    return userData;
  };

  // Logout
  const logout = async () => {
    try {
      const { refreshToken } = getStoredTokens();
      if (refreshToken) {
        await axios.post('/api/auth/logout', { refreshToken });
      }
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      clearTokens();
      setUser(null);
    }
  };

  // Fetch current user info
  const fetchUser = async () => {
    try {
      const token = await getAccessToken();
      if (!token) {
        return null;
      }

      const response = await axios.get('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });

      setUser(response.data.user);
      return response.data.user;
    } catch (error) {
      console.error('Error fetching user:', error);
      clearTokens();
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

        // Try to restore session from stored tokens
        const { accessToken, refreshToken } = getStoredTokens();

        if (accessToken && refreshToken) {
          await fetchUser();
        }
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
    getAccessToken,
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
