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

    // Don't redirect if we're on login or setup pages
    const currentPath = window.location.pathname;
    if (currentPath === '/login' || currentPath === '/setup') {
      return Promise.reject(error);
    }

    // Check if we have tokens - if not, no point in trying to refresh
    const accessToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);

    if (!accessToken && !refreshToken) {
      // No tokens, just reject - let the auth context handle redirect
      return Promise.reject(error);
    }

    // If token is expired, try to refresh
    if (error.response.data?.code === 'TOKEN_EXPIRED' || refreshToken) {
      if (isRefreshing) {
        // Queue the request while refresh is in progress
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        }).catch(err => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      if (!refreshToken) {
        isRefreshing = false;
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        // Use axios directly to avoid interceptor loop
        // Include withCredentials to send cookies
        const response = await axios.post('/api/auth/refresh', { refreshToken }, { withCredentials: true });
        const newToken = response.data.accessToken;

        localStorage.setItem(TOKEN_STORAGE_KEY, newToken);

        // Update header for the original request
        originalRequest.headers.Authorization = `Bearer ${newToken}`;

        processQueue(null, newToken);

        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);

        // Clear tokens and redirect to login
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
        window.location.href = '/login';

        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
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
