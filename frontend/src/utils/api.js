import axios from 'axios';

const TOKEN_STORAGE_KEY = 'opsdec_access_token';
const REFRESH_TOKEN_STORAGE_KEY = 'opsdec_refresh_token';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // Enable sending cookies with requests
});

// Flag to prevent multiple refresh attempts
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Request interceptor - add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle 401 and token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If error is not 401 or request already retried, reject
    if (!error.response || error.response.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Don't try to refresh if we're on login or setup pages
    const currentPath = window.location.pathname;
    if (currentPath === '/login' || currentPath === '/setup') {
      return Promise.reject(error);
    }

    // Don't try to refresh on endpoints that don't need it
    if (originalRequest.url?.includes('/auth/refresh')) {
      return Promise.reject(error);
    }

    // Try to refresh the token - the refresh token is in an HTTP-only cookie
    // so we can't check for it client-side, just attempt the refresh
    if (isRefreshing) {
      // Queue the request while refresh is in progress
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then(() => {
        // Cookie is updated by the server, just retry the request
        return api(originalRequest);
      }).catch(err => {
        return Promise.reject(err);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      // Use axios directly to avoid interceptor loop
      // Include withCredentials to send refresh token cookie
      // Also send localStorage token as fallback for backwards compatibility
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
      await axios.post('/api/auth/refresh', refreshToken ? { refreshToken } : {}, { withCredentials: true });

      processQueue(null);

      // Retry the original request - new access token cookie is set by server
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);

      // Clear any legacy tokens
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);

      // Only redirect if not already on login page
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }

      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

// Helper to get access token for WebSocket (fallback to localStorage for backwards compatibility)
export const getAccessToken = () => {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
};

// Fetch a short-lived token for WebSocket authentication
// This is needed because JavaScript cannot access HTTP-only cookies
export const getWsToken = async () => {
  try {
    const response = await api.post('/auth/ws-token');
    return response.data.wsToken;
  } catch (error) {
    console.error('Failed to get WebSocket token:', error);
    // Fallback to localStorage token for backwards compatibility
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  }
};

export const getActivity = () => api.get('/activity');
export const getHistory = (params = {}) => api.get('/history', { params });
export const deleteHistoryItem = (id) => api.delete(`/history/${id}`);
export const getUsers = () => api.get('/users');
export const getUserStats = (userId) => api.get(`/users/${userId}/stats`);
export const getDashboardStats = () => api.get('/stats/dashboard');
export const getRecentlyAdded = () => api.get('/stats/recently-added?limit=20');
export const getServerHealth = () => api.get('/servers/health');
export const getSettings = () => api.get('/settings');
export const updateSetting = (key, value) => api.put(`/settings/${key}`, { value });
export const getUsersByServer = () => api.get('/settings/users-by-server');
export const getUserMappings = () => api.get('/settings/user-mappings');
export const createUserMapping = (mapping) => api.post('/settings/user-mappings', mapping);
export const deleteUserMapping = (primaryUsername) => api.delete(`/settings/user-mappings/${primaryUsername}`);
export const purgeDatabase = () => api.post('/database/purge');
export const createBackup = () => api.post('/database/backup');
export const getBackups = () => api.get('/database/backups');
export const restoreBackup = (filename) => api.post('/database/restore', { filename });
export const deleteBackup = (filename) => api.delete(`/database/backups/${filename}`);
export const uploadBackup = (file) => {
  const formData = new FormData();
  formData.append('backup', file);
  return api.post('/database/backups/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

// Auth user management (admin only)
export const getAuthUsers = () => api.get('/auth/users');
export const createAuthUser = (userData) => api.post('/auth/users', userData);
export const deleteAuthUser = (id) => api.delete(`/auth/users/${id}`);
export const changePassword = (currentPassword, newPassword) =>
  api.put('/auth/password', { currentPassword, newPassword });

export default api;
