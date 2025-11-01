import { useState, useEffect } from 'react';
import { Plus, Save, Trash2, RefreshCw, Check, X, Server } from 'lucide-react';
import api from '../utils/api';

export default function Settings() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState({});
  const [testResults, setTestResults] = useState({});
  const [editingServer, setEditingServer] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const [formData, setFormData] = useState({
    type: 'emby',
    name: '',
    url: '',
    api_key: '',
    enabled: true
  });

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      const response = await api.get('/servers');
      setServers(response.data.data || []);
    } catch (error) {
      console.error('Failed to load servers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setShowAddForm(true);
    setEditingServer(null);
    setFormData({
      type: 'emby',
      name: '',
      url: '',
      api_key: '',
      enabled: true
    });
  };

  const handleEdit = (server) => {
    setEditingServer(server.id);
    setShowAddForm(true);
    setFormData({
      type: server.type,
      name: server.name,
      url: server.url,
      api_key: server.api_key,
      enabled: server.enabled === 1
    });
  };

  const handleCancel = () => {
    setShowAddForm(false);
    setEditingServer(null);
    setFormData({
      type: 'emby',
      name: '',
      url: '',
      api_key: '',
      enabled: true
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (editingServer) {
        await api.put(`/servers/${editingServer}`, formData);
      } else {
        await api.post('/servers', formData);
      }
      await loadServers();
      handleCancel();
    } catch (error) {
      console.error('Failed to save server:', error);
      alert(`Failed to save server: ${error.response?.data?.error || error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this server?')) return;

    try {
      await api.delete(`/servers/${id}`);
      await loadServers();
    } catch (error) {
      console.error('Failed to delete server:', error);
      alert(`Failed to delete server: ${error.response?.data?.error || error.message}`);
    }
  };

  const handleTest = async (id) => {
    setTesting(prev => ({ ...prev, [id]: true }));
    setTestResults(prev => ({ ...prev, [id]: null }));

    try {
      const response = await api.post(`/servers/${id}/test`);
      setTestResults(prev => ({
        ...prev,
        [id]: {
          success: response.data.data.success,
          message: response.data.data.success
            ? `Connected to ${response.data.data.serverName || 'server'}`
            : `Failed: ${response.data.data.error}`
        }
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [id]: {
          success: false,
          message: `Error: ${error.response?.data?.error || error.message}`
        }
      }));
    } finally {
      setTesting(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleRestartMonitoring = async () => {
    try {
      await api.post('/monitoring/restart');
      alert('Monitoring service restarted successfully!');
    } catch (error) {
      console.error('Failed to restart monitoring:', error);
      alert(`Failed to restart monitoring: ${error.response?.data?.error || error.message}`);
    }
  };

  const getServerTypeLabel = (type) => {
    switch (type) {
      case 'emby': return 'Emby';
      case 'plex': return 'Plex';
      case 'audiobookshelf': return 'Audiobookshelf';
      default: return type;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-400">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">Settings</h1>
        <p className="text-gray-400">Configure your media servers and monitoring options</p>
      </div>

      {/* Header Actions */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={handleAdd}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Server
        </button>
        <button
          onClick={handleRestartMonitoring}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Restart Monitoring
        </button>
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <div className="card mb-6">
          <div className="card-header">
            <h3 className="card-title">
              {editingServer ? 'Edit Server' : 'Add New Server'}
            </h3>
          </div>
          <form onSubmit={handleSubmit} className="card-body space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Server Type
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="input w-full"
                required
              >
                <option value="emby">Emby</option>
                <option value="plex">Plex</option>
                <option value="audiobookshelf">Audiobookshelf</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Server Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input w-full"
                placeholder="My Media Server"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Server URL
              </label>
              <input
                type="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                className="input w-full"
                placeholder="http://localhost:8096"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Include http:// or https:// and port number
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {formData.type === 'plex' ? 'API Token' : 'API Key'}
              </label>
              <input
                type="text"
                value={formData.api_key}
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                className="input w-full font-mono text-sm"
                placeholder={formData.type === 'plex' ? 'Your Plex token' : 'Your API key'}
                required
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="w-4 h-4 text-primary-500 bg-dark-700 border-dark-600 rounded focus:ring-primary-500"
              />
              <label htmlFor="enabled" className="text-sm text-gray-300">
                Enable monitoring for this server
              </label>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Server'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Server List */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Configured Servers</h3>
        </div>
        <div className="card-body p-0">
          {servers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No servers configured yet</p>
              <p className="text-sm mt-1">Add a server to start monitoring</p>
            </div>
          ) : (
            <div className="divide-y divide-dark-600">
              {servers.map((server) => (
                <div key={server.id} className="p-4 hover:bg-dark-750 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-white font-medium">{server.name}</h4>
                        <span className="px-2 py-0.5 text-xs rounded-full bg-dark-700 text-gray-400">
                          {getServerTypeLabel(server.type)}
                        </span>
                        {server.enabled === 1 && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400">
                            Enabled
                          </span>
                        )}
                        {server.enabled === 0 && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-500/20 text-gray-400">
                            Disabled
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 mb-2">{server.url}</p>
                      {testResults[server.id] && (
                        <div className={`flex items-center gap-2 text-sm ${
                          testResults[server.id].success ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {testResults[server.id].success ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            <X className="w-4 h-4" />
                          )}
                          {testResults[server.id].message}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleTest(server.id)}
                        disabled={testing[server.id]}
                        className="px-3 py-1.5 text-sm bg-dark-700 hover:bg-dark-600 text-gray-300 rounded transition-colors disabled:opacity-50"
                      >
                        {testing[server.id] ? 'Testing...' : 'Test'}
                      </button>
                      <button
                        onClick={() => handleEdit(server)}
                        className="px-3 py-1.5 text-sm bg-dark-700 hover:bg-dark-600 text-gray-300 rounded transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(server.id)}
                        className="px-3 py-1.5 text-sm bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
