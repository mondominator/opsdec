import { useState, useEffect } from 'react';
import { Plus, Save, Trash2, RefreshCw, Check, X, Server, AlertCircle } from 'lucide-react';
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
      const isNewServer = !editingServer;

      if (editingServer) {
        await api.put(`/servers/${editingServer}`, formData);
      } else {
        await api.post('/servers', formData);
      }
      await loadServers();
      handleCancel();

      // Restart monitoring after adding a new server
      if (isNewServer) {
        try {
          await api.post('/monitoring/restart');
          console.log('Monitoring service restarted successfully');
        } catch (restartError) {
          console.error('Failed to restart monitoring:', restartError);
        }
      }
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
    const labels = {
      emby: { name: 'Emby', color: 'bg-green-500/20 text-green-400' },
      plex: { name: 'Plex', color: 'bg-yellow-500/20 text-yellow-400' },
      audiobookshelf: { name: 'Audiobookshelf', color: 'bg-blue-500/20 text-blue-400' }
    };
    return labels[type] || { name: type, color: 'bg-gray-500/20 text-gray-400' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-400">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-3">Settings</h1>
        <p className="text-gray-400 text-lg">Configure your media servers and monitoring options</p>
      </div>

      {/* Actions Bar */}
      <div className="flex flex-wrap gap-3 mb-8">
        <button
          onClick={handleAdd}
          className="px-6 py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-lg shadow-primary-500/20"
        >
          <Plus className="w-5 h-5" />
          Add Server
        </button>
        <button
          onClick={handleRestartMonitoring}
          className="px-6 py-3 bg-dark-700 hover:bg-dark-600 text-gray-300 rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <RefreshCw className="w-5 h-5" />
          Restart Monitoring
        </button>
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <div className="bg-dark-800 border border-dark-600 rounded-xl mb-8 overflow-hidden shadow-xl">
          <div className="bg-dark-750 px-6 py-4 border-b border-dark-600">
            <h3 className="text-xl font-semibold text-white">
              {editingServer ? 'Edit Server' : 'Add New Server'}
            </h3>
          </div>
          <form onSubmit={handleSubmit} className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Server Type
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="w-full px-4 py-3 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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
                  className="w-full px-4 py-3 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="My Media Server"
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Server URL
                </label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  className="w-full px-4 py-3 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="http://192.168.1.100:8096"
                  required
                />
                <p className="text-xs text-gray-500 mt-2">
                  Include http:// or https:// and port number
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {formData.type === 'plex' ? 'API Token' : 'API Key'}
                </label>
                <input
                  type="text"
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                  className="w-full px-4 py-3 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
                  placeholder={formData.type === 'plex' ? 'Your Plex token' : 'Your API key'}
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-3 mb-6 p-4 bg-dark-750 rounded-lg">
              <input
                type="checkbox"
                id="enabled"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="w-5 h-5 text-primary-500 bg-dark-700 border-dark-600 rounded focus:ring-primary-500 focus:ring-2 cursor-pointer"
              />
              <label htmlFor="enabled" className="text-base text-gray-300 cursor-pointer flex-1">
                Enable monitoring for this server
              </label>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-primary-600 hover:bg-primary-500 disabled:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <Save className="w-5 h-5" />
                {saving ? 'Saving...' : 'Save Server'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-3 bg-dark-700 hover:bg-dark-600 text-gray-300 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Server List */}
      <div className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden shadow-xl">
        <div className="bg-dark-750 px-6 py-4 border-b border-dark-600">
          <h3 className="text-xl font-semibold text-white">Configured Servers</h3>
        </div>
        <div>
          {servers.length === 0 ? (
            <div className="p-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-dark-700 rounded-full mb-4">
                <Server className="w-8 h-8 text-gray-500" />
              </div>
              <p className="text-gray-400 text-lg mb-2">No servers configured yet</p>
              <p className="text-gray-500">Add a server to start monitoring your media</p>
            </div>
          ) : (
            <div className="divide-y divide-dark-600">
              {servers.map((server) => {
                const typeInfo = getServerTypeLabel(server.type);
                return (
                  <div key={server.id} className="p-6 hover:bg-dark-750 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-3 flex-wrap">
                          <h4 className="text-lg font-semibold text-white">{server.name}</h4>
                          <span className={`px-3 py-1 text-sm font-medium rounded-full ${typeInfo.color}`}>
                            {typeInfo.name}
                          </span>
                          {server.enabled === 1 ? (
                            <span className="px-3 py-1 text-sm font-medium rounded-full bg-green-500/20 text-green-400">
                              Enabled
                            </span>
                          ) : (
                            <span className="px-3 py-1 text-sm font-medium rounded-full bg-gray-500/20 text-gray-400">
                              Disabled
                            </span>
                          )}
                        </div>
                        <p className="text-gray-400 mb-3 font-mono text-sm">{server.url}</p>
                        {testResults[server.id] && (
                          <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                            testResults[server.id].success 
                              ? 'bg-green-500/10 text-green-400' 
                              : 'bg-red-500/10 text-red-400'
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
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleTest(server.id)}
                          disabled={testing[server.id]}
                          className="px-4 py-2 bg-dark-700 hover:bg-dark-600 disabled:bg-dark-750 disabled:opacity-50 text-gray-300 rounded-lg font-medium transition-colors"
                        >
                          {testing[server.id] ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          onClick={() => handleEdit(server)}
                          className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-gray-300 rounded-lg font-medium transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(server.id)}
                          className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg font-medium transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
