import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

export const getActivity = () => api.get('/activity');
export const getHistory = (params = {}) => api.get('/history', { params });
export const deleteHistoryItem = (id) => api.delete(`/history/${id}`);
export const getUsers = () => api.get('/users');
export const getUserStats = (userId) => api.get(`/users/${userId}/stats`);
export const getDashboardStats = () => api.get('/stats/dashboard');
export const getRecentMedia = (limit = 20) => api.get('/media/recent', { params: { limit } });
export const testEmbyConnection = () => api.get('/emby/test');
export const getEmbyLibraries = () => api.get('/emby/libraries');
export const getServerHealth = () => api.get('/servers/health');
export const getSettings = () => api.get('/settings');
export const updateSetting = (key, value) => api.put(`/settings/${key}`, { value });

export default api;
