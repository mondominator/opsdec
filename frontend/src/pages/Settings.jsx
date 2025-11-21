import { useState, useEffect } from 'react';
import { Plus, Save, Trash2, RefreshCw, Check, X, Server, AlertCircle, Film, Tv, Headphones, Globe, Users as UsersIcon, Database, Download, Upload, Archive } from 'lucide-react';
import api, { getSettings, updateSetting, getUserMappings, createUserMapping, deleteUserMapping, getUsersByServer, purgeDatabase, createBackup, getBackups, restoreBackup, deleteBackup, uploadBackup } from '../utils/api';
import { useTimezone } from '../contexts/TimezoneContext';

export default function Settings() {
  const { timezone: currentTimezone, setTimezone: updateTimezone } = useTimezone();
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState({});
  const [testResults, setTestResults] = useState({});
  const [serverVersions, setServerVersions] = useState({});
  const [editingServer, setEditingServer] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [settings, setSettings] = useState({ timezone: 'UTC' });
  const [savingSettings, setSavingSettings] = useState(false);
  const [purgingDatabase, setPurgingDatabase] = useState(false);

  // Backup/restore state
  const [backups, setBackups] = useState([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [uploadingBackup, setUploadingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(null);

  // User mappings state
  const [userMappings, setUserMappings] = useState([]);
  const [usersByServer, setUsersByServer] = useState({ plex: [], emby: [], audiobookshelf: [], sappho: [] });
  const [showMappingForm, setShowMappingForm] = useState(false);
  const [mappingFormData, setMappingFormData] = useState({
    primary_username: '',
    mappings: {
      plex: '',
      emby: '',
      audiobookshelf: '',
      sappho: ''
    },
    preferred_avatar_server: 'plex' // Which server's avatar to use
  });
  const [savingMapping, setSavingMapping] = useState(false);

  const [formData, setFormData] = useState({
    type: 'emby',
    name: '',
    url: '',
    api_key: '',
    enabled: true
  });

  useEffect(() => {
    loadServers();
    loadSettings();
    loadUserMappings();
    loadUsersByServer();
    loadBackups();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await getSettings();
      setSettings(response.data.data);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const loadUserMappings = async () => {
    try {
      const response = await getUserMappings();
      setUserMappings(response.data.data || []);
    } catch (error) {
      console.error('Failed to load user mappings:', error);
    }
  };

  const loadUsersByServer = async () => {
    try {
      const response = await getUsersByServer();
      setUsersByServer(response.data.data || { plex: [], emby: [], audiobookshelf: [], sappho: [] });
    } catch (error) {
      console.error('Failed to load users by server:', error);
    }
  };

  const loadBackups = async () => {
    setLoadingBackups(true);
    try {
      const response = await getBackups();
      setBackups(response.data.backups || []);
    } catch (error) {
      console.error('Failed to load backups:', error);
    } finally {
      setLoadingBackups(false);
    }
  };

  // Silently fetch version info when page loads
  useEffect(() => {
    const fetchVersions = async () => {
      if (servers.length > 0) {
        for (const server of servers) {
          try {
            const response = await api.post(`/servers/${server.id}/test`);

            if (response.data.success && response.data.data && response.data.data.version) {
              setServerVersions(prev => ({
                ...prev,
                [server.id]: response.data.data.version
              }));
            }
          } catch (error) {
            console.error(`Failed to fetch version for ${server.id}:`, error);
          }
        }
      }
    };

    fetchVersions();
  }, [servers.length]);

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
      let serverId;

      if (editingServer) {
        await api.put(`/servers/${editingServer}`, formData);
        serverId = editingServer;
      } else {
        const response = await api.post('/servers', formData);
        serverId = response.data.data.id;
      }
      await loadServers();
      handleCancel();

      // For new servers, automatically test connection and restart monitoring
      if (isNewServer && serverId) {
        try {
          // Test the connection
          setTesting(prev => ({ ...prev, [serverId]: true }));
          const testResponse = await api.post(`/servers/${serverId}/test`);
          setTestResults(prev => ({
            ...prev,
            [serverId]: {
              success: testResponse.data.data.success,
              message: testResponse.data.data.success
                ? `Connected to ${testResponse.data.data.serverName || 'server'}`
                : `Failed: ${testResponse.data.data.error}`
            }
          }));
          setTesting(prev => ({ ...prev, [serverId]: false }));

          // Restart monitoring
          await api.post('/monitoring/restart');
          console.log('Monitoring service restarted successfully');
        } catch (error) {
          console.error('Failed to test or restart:', error);
          setTesting(prev => ({ ...prev, [serverId]: false }));
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
      console.log(`Testing server: ${id}`);
      console.log(`Request URL: /api/servers/${id}/test`);
      const response = await api.post(`/servers/${id}/test`);
      console.log(`Test response:`, response);
      setTestResults(prev => ({
        ...prev,
        [id]: {
          success: response.data.data.success,
          message: response.data.data.success
            ? response.data.data.message || `Connected to ${response.data.data.serverName || 'server'}`
            : response.data.data.error || 'Connection failed',
          version: response.data.data.version
        }
      }));

      // Clear the test result after 5 seconds
      setTimeout(() => {
        setTestResults(prev => {
          const newResults = { ...prev };
          delete newResults[id];
          return newResults;
        });
      }, 5000);
    } catch (error) {
      console.error(`Test error for ${id}:`, error);
      console.error(`Error response:`, error.response);
      setTestResults(prev => ({
        ...prev,
        [id]: {
          success: false,
          message: `Error: ${error.response?.data?.error || error.message}`
        }
      }));

      // Clear the error result after 5 seconds
      setTimeout(() => {
        setTestResults(prev => {
          const newResults = { ...prev };
          delete newResults[id];
          return newResults;
        });
      }, 5000);
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

  const handleTimezoneChange = async (timezone) => {
    setSavingSettings(true);
    try {
      await updateSetting('timezone', timezone);
      setSettings({ ...settings, timezone });
      // Update the timezone in context (which updates format utility)
      updateTimezone(timezone);
    } catch (error) {
      console.error('Failed to update timezone:', error);
      alert(`Failed to update timezone: ${error.response?.data?.error || error.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const handlePurgeDatabase = async () => {
    if (!confirm('⚠️ WARNING: This will delete ALL user data, history, and statistics!\n\nA backup will be created first, but this action cannot be easily undone.\n\nServer settings and timezone will be preserved.\n\nAre you absolutely sure you want to continue?')) {
      return;
    }

    // Second confirmation
    if (!confirm('This is your final warning. All user data will be permanently deleted. Continue?')) {
      return;
    }

    setPurgingDatabase(true);
    try {
      const response = await purgeDatabase();
      alert(`Database purged successfully!\n\nBackup created at: ${response.data.backupPath}\n\nThe page will now reload.`);
      // Reload the page to reflect the empty state
      window.location.reload();
    } catch (error) {
      console.error('Failed to purge database:', error);
      alert(`Failed to purge database: ${error.response?.data?.error || error.message}`);
    } finally {
      setPurgingDatabase(false);
    }
  };

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      const response = await createBackup();
      alert(`Backup created successfully!\n\nFilename: ${response.data.backup.filename}\nSize: ${(response.data.backup.size / 1024 / 1024).toFixed(2)} MB`);
      loadBackups();
    } catch (error) {
      console.error('Failed to create backup:', error);
      alert(`Failed to create backup: ${error.response?.data?.error || error.message}`);
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleUploadBackup = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.db')) {
      alert('Please select a valid database backup file (.db)');
      event.target.value = '';
      return;
    }

    setUploadingBackup(true);
    try {
      const response = await uploadBackup(file);
      alert(`Backup uploaded successfully!\n\nFilename: ${response.data.backup.filename}\nSize: ${(response.data.backup.size / 1024 / 1024).toFixed(2)} MB`);
      loadBackups();
    } catch (error) {
      console.error('Failed to upload backup:', error);
      alert(`Failed to upload backup: ${error.response?.data?.error || error.message}`);
    } finally {
      setUploadingBackup(false);
      event.target.value = '';
    }
  };

  const handleRestoreBackup = async (filename) => {
    if (!confirm(`⚠️ WARNING: This will restore the database from backup "${filename}".\n\nA safety backup of the current database will be created first.\n\nThis action will replace all current data with the backup data.\n\nAre you sure you want to continue?`)) {
      return;
    }

    setRestoringBackup(filename);
    try {
      const response = await restoreBackup(filename);
      alert(`Database restored successfully!\n\nSafety backup created at: ${response.data.safetyBackup}\n\nThe page will now reload.`);
      window.location.reload();
    } catch (error) {
      console.error('Failed to restore backup:', error);
      alert(`Failed to restore backup: ${error.response?.data?.error || error.message}`);
    } finally {
      setRestoringBackup(null);
    }
  };

  const handleDeleteBackup = async (filename) => {
    if (!confirm(`Are you sure you want to delete the backup "${filename}"?\n\nThis action cannot be undone.`)) {
      return;
    }

    try {
      await deleteBackup(filename);
      alert('Backup deleted successfully!');
      loadBackups();
    } catch (error) {
      console.error('Failed to delete backup:', error);
      alert(`Failed to delete backup: ${error.response?.data?.error || error.message}`);
    }
  };

  const formatBackupDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const formatFileSize = (bytes) => {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  const handleAddMapping = () => {
    setShowMappingForm(true);
    setMappingFormData({
      primary_username: '',
      mappings: {
        plex: '',
        emby: '',
        audiobookshelf: '',
        sappho: ''
      },
      preferred_avatar_server: 'plex'
    });
  };

  const handleEditMapping = (mapping) => {
    setShowMappingForm(true);
    setMappingFormData({
      primary_username: mapping.primary_username,
      mappings: {
        plex: mapping.mappings.plex || '',
        emby: mapping.mappings.emby || '',
        audiobookshelf: mapping.mappings.audiobookshelf || '',
        sappho: mapping.mappings.sappho || ''
      },
      preferred_avatar_server: mapping.preferred_avatar_server || 'plex'
    });
  };

  const handleCancelMapping = () => {
    setShowMappingForm(false);
    setMappingFormData({
      primary_username: '',
      mappings: {
        plex: '',
        emby: '',
        audiobookshelf: '',
        sappho: ''
      },
      preferred_avatar_server: 'plex'
    });
  };

  const handleSubmitMapping = async (e) => {
    e.preventDefault();
    setSavingMapping(true);

    try {
      await createUserMapping(mappingFormData);
      await loadUserMappings();
      handleCancelMapping();
    } catch (error) {
      console.error('Failed to save mapping:', error);
      alert(`Failed to save mapping: ${error.response?.data?.error || error.message}`);
    } finally {
      setSavingMapping(false);
    }
  };

  const handleDeleteMapping = async (primaryUsername) => {
    if (!confirm('Are you sure you want to delete this user mapping?')) return;

    try {
      await deleteUserMapping(primaryUsername);
      await loadUserMappings();
    } catch (error) {
      console.error('Failed to delete mapping:', error);
      alert(`Failed to delete mapping: ${error.response?.data?.error || error.message}`);
    }
  };

  const getServerTypeLabel = (type) => {
    const labels = {
      emby: { name: 'Emby', color: 'bg-green-500/20 text-green-400' },
      plex: { name: 'Plex', color: 'bg-yellow-500/20 text-yellow-400' },
      audiobookshelf: { name: 'Audiobookshelf', color: 'bg-amber-500/20 text-amber-600' },
      sappho: { name: 'Sappho', color: 'bg-blue-500/20 text-blue-400' }
    };
    return labels[type] || { name: type, color: 'bg-gray-500/20 text-gray-400' };
  };

  const getServerIcon = (type) => {
    switch (type) {
      case 'emby':
        return <img src="/logos/emby.svg" alt="Emby" className="w-5 h-5" />;
      case 'plex':
        return <img src="/logos/plex.svg" alt="Plex" className="w-5 h-5" />;
      case 'audiobookshelf':
        return <img src="/logos/audiobookshelf.svg" alt="Audiobookshelf" className="w-5 h-5" />;
      case 'sappho':
        return <img src="/logos/sappho.png" alt="Sappho" className="w-5 h-5" />;
      default:
        return <Server className="w-5 h-5" />;
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
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-3">Settings</h1>
        <p className="text-gray-400 text-lg">Configure your media servers and monitoring options</p>
      </div>

      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-8">
        <button
          onClick={handleAdd}
          className="px-6 py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-primary-500/20"
        >
          <Plus className="w-5 h-5" />
          Add Server
        </button>
        <button
          onClick={handleRestartMonitoring}
          className="px-6 py-3 bg-dark-700 hover:bg-dark-600 text-gray-300 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
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
                  <option value="sappho">Sappho</option>
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
      <div className="mb-4">
        <h3 className="text-xl font-semibold text-white mb-4">Configured Servers</h3>
      </div>

      {servers.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-dark-700 rounded-full mb-4">
            <Server className="w-8 h-8 text-gray-500" />
          </div>
          <p className="text-gray-400 text-lg mb-2">No servers configured yet</p>
          <p className="text-gray-500">Add a server to start monitoring your media</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {servers.map((server) => {
            const typeInfo = getServerTypeLabel(server.type);
            return (
              <div key={server.id} className={`card ${server.from_env ? 'opacity-90' : ''}`}>
                <div className="p-4 sm:p-6 flex flex-col h-full">
                  {/* Header */}
                  <div className="mb-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${server.enabled === 1 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-gray-500'}`} />
                      <h4 className="text-lg font-semibold text-white">{server.name}</h4>
                    </div>
                    <div className="ml-5">
                      <span className={`px-3 py-1 text-sm font-medium rounded-full inline-flex items-center gap-2 ${typeInfo.color}`}>
                        {getServerIcon(server.type)}
                        {typeInfo.name}
                      </span>
                    </div>
                  </div>

                  {/* Environment Variable Badge */}
                  {server.from_env && (
                    <div className="mb-3 px-3 py-2 text-sm font-medium rounded-lg bg-blue-500/20 text-blue-400 flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      Environment Variable
                    </div>
                  )}

                  {/* Server Details */}
                  <div className="space-y-2 mb-4 pb-4 border-b border-dark-700">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-gray-500 text-sm flex-shrink-0">URL:</span>
                      <span className="text-gray-400 font-mono text-sm truncate text-right">{server.url}</span>
                    </div>
                    {serverVersions[server.id] && serverVersions[server.id] !== 'Unknown' && (
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-gray-500 text-sm flex-shrink-0">Version:</span>
                        <span className="text-gray-400 font-medium text-sm">{serverVersions[server.id]}</span>
                      </div>
                    )}
                  </div>

                  {/* Environment Warning */}
                  {server.from_env && (
                    <div className="text-yellow-400/80 text-sm mb-4 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>This server is configured via environment variables and cannot be edited or deleted through the UI.</span>
                    </div>
                  )}

                  {/* Test Results */}
                  {testResults[server.id] && (
                    <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium mb-4 ${
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

                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-2 mt-auto">
                    <button
                      onClick={() => handleTest(server.id)}
                      disabled={testing[server.id]}
                      className="flex-1 px-4 py-2 bg-dark-700 hover:bg-dark-600 disabled:bg-dark-750 disabled:opacity-50 text-gray-300 rounded-lg font-medium transition-colors text-sm"
                    >
                      {testing[server.id] ? 'Testing...' : 'Test'}
                    </button>
                    {!server.from_env && (
                      <>
                        <button
                          onClick={() => handleEdit(server)}
                          className="flex-1 px-4 py-2 bg-dark-700 hover:bg-dark-600 text-gray-300 rounded-lg font-medium transition-colors text-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(server.id)}
                          className="sm:flex-none px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg font-medium transition-colors text-sm flex items-center justify-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="sm:hidden">Delete</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* User Mappings Section */}
      <div className="bg-dark-800 rounded-lg p-4 sm:p-6 border border-dark-700 mt-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-100 mb-2">User Mappings</h2>
            <p className="text-sm text-gray-400">Create a primary user and select which username from each server maps to it</p>
          </div>
          <button
            onClick={handleAddMapping}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 sm:flex-none"
          >
            <Plus className="w-4 h-4" />
            Add User
          </button>
        </div>

        {/* Add/Edit Mapping Form */}
        {showMappingForm && (
          <div className="bg-dark-750 border border-dark-600 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              {mappingFormData.primary_username && userMappings.some(m => m.primary_username === mappingFormData.primary_username) ? 'Edit User Mapping' : 'Add New User Mapping'}
            </h3>
            <form onSubmit={handleSubmitMapping}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Primary Username
                </label>
                <input
                  type="text"
                  value={mappingFormData.primary_username}
                  onChange={(e) => setMappingFormData({ ...mappingFormData, primary_username: e.target.value })}
                  className="w-full px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Primary display name"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">This is the username that will be displayed in all statistics</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {/* Plex */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    {getServerIcon('plex')}
                    Plex Username
                  </label>
                  <select
                    value={mappingFormData.mappings.plex}
                    onChange={(e) => setMappingFormData({
                      ...mappingFormData,
                      mappings: { ...mappingFormData.mappings, plex: e.target.value }
                    })}
                    className="w-full px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">None</option>
                    {usersByServer.plex?.map(user => (
                      <option key={user.username} value={user.username}>{user.username}</option>
                    ))}
                  </select>
                </div>

                {/* Emby */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    {getServerIcon('emby')}
                    Emby Username
                  </label>
                  <select
                    value={mappingFormData.mappings.emby}
                    onChange={(e) => setMappingFormData({
                      ...mappingFormData,
                      mappings: { ...mappingFormData.mappings, emby: e.target.value }
                    })}
                    className="w-full px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">None</option>
                    {usersByServer.emby?.map(user => (
                      <option key={user.username} value={user.username}>{user.username}</option>
                    ))}
                  </select>
                </div>

                {/* Audiobookshelf */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    {getServerIcon('audiobookshelf')}
                    Audiobookshelf Username
                  </label>
                  <select
                    value={mappingFormData.mappings.audiobookshelf}
                    onChange={(e) => setMappingFormData({
                      ...mappingFormData,
                      mappings: { ...mappingFormData.mappings, audiobookshelf: e.target.value }
                    })}
                    className="w-full px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">None</option>
                    {usersByServer.audiobookshelf?.map(user => (
                      <option key={user.username} value={user.username}>{user.username}</option>
                    ))}
                  </select>
                </div>

                {/* Sappho */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    {getServerIcon('sappho')}
                    Sappho Username
                  </label>
                  <select
                    value={mappingFormData.mappings.sappho}
                    onChange={(e) => setMappingFormData({
                      ...mappingFormData,
                      mappings: { ...mappingFormData.mappings, sappho: e.target.value }
                    })}
                    className="w-full px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">None</option>
                    {usersByServer.sappho?.map(user => (
                      <option key={user.username} value={user.username}>{user.username}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Avatar Selection */}
              <div className="mb-6 p-4 bg-dark-700/50 border border-dark-600 rounded-lg">
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Preferred Avatar
                </label>
                <p className="text-xs text-gray-500 mb-3">Choose which server's avatar to display for this user</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Plex Avatar Option */}
                  <label className="flex items-center gap-3 p-3 bg-dark-700 border border-dark-600 rounded-lg cursor-pointer hover:border-primary-500 transition-colors">
                    <input
                      type="radio"
                      name="preferred_avatar"
                      value="plex"
                      checked={mappingFormData.preferred_avatar_server === 'plex'}
                      onChange={(e) => setMappingFormData({
                        ...mappingFormData,
                        preferred_avatar_server: e.target.value
                      })}
                      className="w-4 h-4 text-primary-600 focus:ring-primary-500 focus:ring-2"
                      disabled={!mappingFormData.mappings.plex}
                    />
                    <div className="flex items-center gap-2">
                      {getServerIcon('plex')}
                      <span className={`text-sm ${mappingFormData.mappings.plex ? 'text-gray-200' : 'text-gray-500'}`}>
                        Plex
                      </span>
                    </div>
                  </label>

                  {/* Emby Avatar Option */}
                  <label className="flex items-center gap-3 p-3 bg-dark-700 border border-dark-600 rounded-lg cursor-pointer hover:border-primary-500 transition-colors">
                    <input
                      type="radio"
                      name="preferred_avatar"
                      value="emby"
                      checked={mappingFormData.preferred_avatar_server === 'emby'}
                      onChange={(e) => setMappingFormData({
                        ...mappingFormData,
                        preferred_avatar_server: e.target.value
                      })}
                      className="w-4 h-4 text-primary-600 focus:ring-primary-500 focus:ring-2"
                      disabled={!mappingFormData.mappings.emby}
                    />
                    <div className="flex items-center gap-2">
                      {getServerIcon('emby')}
                      <span className={`text-sm ${mappingFormData.mappings.emby ? 'text-gray-200' : 'text-gray-500'}`}>
                        Emby
                      </span>
                    </div>
                  </label>

                  {/* Audiobookshelf Avatar Option */}
                  <label className="flex items-center gap-3 p-3 bg-dark-700 border border-dark-600 rounded-lg cursor-pointer hover:border-primary-500 transition-colors">
                    <input
                      type="radio"
                      name="preferred_avatar"
                      value="audiobookshelf"
                      checked={mappingFormData.preferred_avatar_server === 'audiobookshelf'}
                      onChange={(e) => setMappingFormData({
                        ...mappingFormData,
                        preferred_avatar_server: e.target.value
                      })}
                      className="w-4 h-4 text-primary-600 focus:ring-primary-500 focus:ring-2"
                      disabled={!mappingFormData.mappings.audiobookshelf}
                    />
                    <div className="flex items-center gap-2">
                      {getServerIcon('audiobookshelf')}
                      <span className={`text-sm ${mappingFormData.mappings.audiobookshelf ? 'text-gray-200' : 'text-gray-500'}`}>
                        Audiobookshelf
                      </span>
                    </div>
                  </label>

                  {/* Sappho Avatar Option */}
                  <label className="flex items-center gap-3 p-3 bg-dark-700 border border-dark-600 rounded-lg cursor-pointer hover:border-primary-500 transition-colors">
                    <input
                      type="radio"
                      name="preferred_avatar"
                      value="sappho"
                      checked={mappingFormData.preferred_avatar_server === 'sappho'}
                      onChange={(e) => setMappingFormData({
                        ...mappingFormData,
                        preferred_avatar_server: e.target.value
                      })}
                      className="w-4 h-4 text-primary-600 focus:ring-primary-500 focus:ring-2"
                      disabled={!mappingFormData.mappings.sappho}
                    />
                    <div className="flex items-center gap-2">
                      {getServerIcon('sappho')}
                      <span className={`text-sm ${mappingFormData.mappings.sappho ? 'text-gray-200' : 'text-gray-500'}`}>
                        Sappho
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={savingMapping}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  {savingMapping ? 'Saving...' : 'Save Mapping'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelMapping}
                  className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-gray-300 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Mappings List */}
        {userMappings.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-dark-700 rounded-full mb-4">
              <UsersIcon className="w-8 h-8 text-gray-500" />
            </div>
            <p className="text-gray-400 text-lg mb-2">No user mappings configured</p>
            <p className="text-gray-500">Add a user mapping to consolidate usernames from different servers</p>
          </div>
        ) : (
          <div className="space-y-3">
            {userMappings.map((mapping, index) => {
              // Get avatar from preferred server first, then fall back to any available
              let avatarUrl = null;
              const preferredServer = mapping.preferred_avatar_server || 'plex';

              // Try preferred server first
              if (mapping.mappings[preferredServer]) {
                const user = usersByServer[preferredServer]?.find(u => u.username === mapping.mappings[preferredServer]);
                if (user?.thumb) {
                  avatarUrl = user.thumb;
                }
              }

              // If no avatar from preferred server, try others
              if (!avatarUrl) {
                for (const serverType of ['plex', 'emby', 'audiobookshelf', 'sappho']) {
                  if (serverType !== preferredServer && mapping.mappings[serverType]) {
                    const user = usersByServer[serverType]?.find(u => u.username === mapping.mappings[serverType]);
                    if (user?.thumb) {
                      avatarUrl = user.thumb;
                      break;
                    }
                  }
                }
              }

              return (
                <div key={index} className="bg-dark-750 border border-dark-600 rounded-lg p-4 hover:border-dark-500 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      {/* Avatar */}
                      {avatarUrl ? (
                        <img
                          src={`/proxy/image?url=${encodeURIComponent(avatarUrl)}`}
                          alt={mapping.primary_username}
                          className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
                          <span className="text-white font-semibold text-lg">
                            {mapping.primary_username.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}

                      {/* User info */}
                      <div className="flex-1 min-w-0">
                        <h4 className="text-white font-semibold mb-2">{mapping.primary_username}</h4>
                        <div className="flex flex-wrap gap-2">
                          {/* Plex */}
                          {mapping.mappings.plex && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-dark-700 rounded text-xs">
                              {getServerIcon('plex')}
                              <span className="text-gray-300">{mapping.mappings.plex}</span>
                            </div>
                          )}
                          {/* Emby */}
                          {mapping.mappings.emby && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-dark-700 rounded text-xs">
                              {getServerIcon('emby')}
                              <span className="text-gray-300">{mapping.mappings.emby}</span>
                            </div>
                          )}
                          {/* Audiobookshelf */}
                          {mapping.mappings.audiobookshelf && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-dark-700 rounded text-xs">
                              {getServerIcon('audiobookshelf')}
                              <span className="text-gray-300">{mapping.mappings.audiobookshelf}</span>
                            </div>
                          )}
                          {/* Sappho */}
                          {mapping.mappings.sappho && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-dark-700 rounded text-xs">
                              {getServerIcon('sappho')}
                              <span className="text-gray-300">{mapping.mappings.sappho}</span>
                            </div>
                          )}
                          {!mapping.mappings.plex && !mapping.mappings.emby && !mapping.mappings.audiobookshelf && !mapping.mappings.sappho && (
                            <span className="text-gray-500 text-sm">No server mappings</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditMapping(mapping)}
                        className="flex-1 sm:flex-none px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-gray-300 rounded-lg font-medium transition-colors text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteMapping(mapping.primary_username)}
                        className="flex-1 sm:flex-none px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg font-medium transition-colors inline-flex items-center justify-center gap-1 text-sm"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span className="sm:hidden">Delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Application Settings */}
      <div className="bg-dark-800 rounded-lg p-4 sm:p-6 border border-dark-700 mt-6">
        <h2 className="text-xl font-semibold text-gray-100 mb-6">Application Settings</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Timezone
            </label>
            <select
              value={settings.timezone || 'UTC'}
              onChange={(e) => handleTimezoneChange(e.target.value)}
              disabled={savingSettings}
              className="w-full px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <optgroup label="UTC">
                <option value="UTC">UTC</option>
              </optgroup>
              <optgroup label="Americas">
                <option value="America/New_York">Eastern Time (New York)</option>
                <option value="America/Chicago">Central Time (Chicago)</option>
                <option value="America/Denver">Mountain Time (Denver)</option>
                <option value="America/Phoenix">Mountain Time - Arizona (Phoenix)</option>
                <option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>
                <option value="America/Anchorage">Alaska Time (Anchorage)</option>
                <option value="Pacific/Honolulu">Hawaii Time (Honolulu)</option>
                <option value="America/Toronto">Eastern Time (Toronto)</option>
                <option value="America/Vancouver">Pacific Time (Vancouver)</option>
                <option value="America/Mexico_City">Central Time (Mexico City)</option>
                <option value="America/Sao_Paulo">Brasilia Time (São Paulo)</option>
                <option value="America/Buenos_Aires">Argentina Time (Buenos Aires)</option>
                <option value="America/Santiago">Chile Time (Santiago)</option>
                <option value="America/Lima">Peru Time (Lima)</option>
                <option value="America/Bogota">Colombia Time (Bogotá)</option>
              </optgroup>
              <optgroup label="Europe">
                <option value="Europe/London">GMT/BST (London)</option>
                <option value="Europe/Dublin">GMT/IST (Dublin)</option>
                <option value="Europe/Paris">CET/CEST (Paris)</option>
                <option value="Europe/Berlin">CET/CEST (Berlin)</option>
                <option value="Europe/Rome">CET/CEST (Rome)</option>
                <option value="Europe/Madrid">CET/CEST (Madrid)</option>
                <option value="Europe/Amsterdam">CET/CEST (Amsterdam)</option>
                <option value="Europe/Brussels">CET/CEST (Brussels)</option>
                <option value="Europe/Vienna">CET/CEST (Vienna)</option>
                <option value="Europe/Zurich">CET/CEST (Zurich)</option>
                <option value="Europe/Stockholm">CET/CEST (Stockholm)</option>
                <option value="Europe/Athens">EET/EEST (Athens)</option>
                <option value="Europe/Helsinki">EET/EEST (Helsinki)</option>
                <option value="Europe/Istanbul">Turkey Time (Istanbul)</option>
                <option value="Europe/Moscow">Moscow Time (Moscow)</option>
              </optgroup>
              <optgroup label="Asia">
                <option value="Asia/Dubai">Gulf Time (Dubai)</option>
                <option value="Asia/Kolkata">India Time (Kolkata)</option>
                <option value="Asia/Dhaka">Bangladesh Time (Dhaka)</option>
                <option value="Asia/Bangkok">Indochina Time (Bangkok)</option>
                <option value="Asia/Singapore">Singapore Time (Singapore)</option>
                <option value="Asia/Hong_Kong">Hong Kong Time (Hong Kong)</option>
                <option value="Asia/Shanghai">China Time (Shanghai)</option>
                <option value="Asia/Tokyo">Japan Time (Tokyo)</option>
                <option value="Asia/Seoul">Korea Time (Seoul)</option>
                <option value="Asia/Jakarta">Indonesia Western Time (Jakarta)</option>
                <option value="Asia/Manila">Philippines Time (Manila)</option>
                <option value="Asia/Taipei">Taiwan Time (Taipei)</option>
                <option value="Asia/Karachi">Pakistan Time (Karachi)</option>
              </optgroup>
              <optgroup label="Australia & Pacific">
                <option value="Australia/Perth">Australian Western Time (Perth)</option>
                <option value="Australia/Adelaide">Australian Central Time (Adelaide)</option>
                <option value="Australia/Darwin">Australian Central Time (Darwin)</option>
                <option value="Australia/Brisbane">Australian Eastern Time (Brisbane)</option>
                <option value="Australia/Sydney">Australian Eastern Time (Sydney)</option>
                <option value="Australia/Melbourne">Australian Eastern Time (Melbourne)</option>
                <option value="Pacific/Auckland">New Zealand Time (Auckland)</option>
                <option value="Pacific/Fiji">Fiji Time (Fiji)</option>
              </optgroup>
              <optgroup label="Africa">
                <option value="Africa/Cairo">Eastern European Time (Cairo)</option>
                <option value="Africa/Johannesburg">South Africa Time (Johannesburg)</option>
                <option value="Africa/Lagos">West Africa Time (Lagos)</option>
                <option value="Africa/Nairobi">East Africa Time (Nairobi)</option>
              </optgroup>
            </select>
            {savingSettings && (
              <p className="mt-2 text-sm text-gray-400">Saving...</p>
            )}
          </div>
        </div>
      </div>

      {/* Database Management */}
      <div className="bg-dark-800 rounded-lg p-4 sm:p-6 mt-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-primary-500" />
            <h2 className="text-xl font-semibold text-gray-100">Database Management</h2>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={handleCreateBackup}
              disabled={creatingBackup}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <Download className="w-4 h-4" />
              {creatingBackup ? 'Creating...' : 'Create Backup'}
            </button>
            <label className="px-4 py-2 bg-accent-600 hover:bg-accent-500 disabled:bg-accent-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer text-sm">
              <Upload className="w-4 h-4" />
              {uploadingBackup ? 'Uploading...' : 'Upload Backup'}
              <input
                type="file"
                accept=".db"
                onChange={handleUploadBackup}
                disabled={uploadingBackup}
                className="hidden"
              />
            </label>
          </div>
        </div>

        <p className="text-sm text-gray-400 mb-4">
          Manage database backups. Create manual backups, upload existing backup files, or restore from available backups.
        </p>

        {loadingBackups ? (
          <div className="text-center py-8 text-gray-400">Loading backups...</div>
        ) : backups.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No backups available. Create a backup to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {backups.map((backup) => (
              <div
                key={backup.filename}
                className="bg-dark-750 border border-dark-700 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Database className="w-4 h-4 text-primary-400 flex-shrink-0" />
                    <span className="font-medium text-gray-200 truncate">{backup.filename}</span>
                  </div>
                  <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Created: {formatBackupDate(backup.created)}</span>
                    <span>Size: {formatFileSize(backup.size)}</span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => handleRestoreBackup(backup.filename)}
                    disabled={restoringBackup === backup.filename}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-700 disabled:opacity-50 text-white rounded text-xs sm:text-sm font-medium transition-colors flex items-center justify-center gap-1"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {restoringBackup === backup.filename ? 'Restoring...' : 'Restore'}
                  </button>
                  <a
                    href={`/api/database/backups/${backup.filename}/download`}
                    download={backup.filename}
                    className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded text-xs sm:text-sm font-medium transition-colors flex items-center justify-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </a>
                  <button
                    onClick={() => handleDeleteBackup(backup.filename)}
                    disabled={restoringBackup === backup.filename}
                    className="px-3 py-1.5 bg-dark-600 hover:bg-dark-500 disabled:opacity-50 text-gray-300 rounded text-xs sm:text-sm font-medium transition-colors flex items-center justify-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className="bg-dark-800 rounded-lg p-4 sm:p-6 border border-red-900/50 mt-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <h2 className="text-xl font-semibold text-red-400">Danger Zone</h2>
        </div>

        <div className="space-y-4">
          <div className="bg-dark-750/50 border border-red-900/30 rounded-lg p-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-100 mb-2 flex items-center gap-2">
                  <Database className="w-5 h-5 text-red-400" />
                  Purge Database
                </h3>
                <p className="text-sm text-gray-400 mb-2">
                  Permanently delete all user data, watch history, sessions, and statistics from the database.
                </p>
                <ul className="text-xs text-gray-500 space-y-1 mb-3">
                  <li>• A backup will be created automatically before purging</li>
                  <li>• Server settings and timezone will be preserved</li>
                  <li>• User mappings will be removed</li>
                  <li>• This action cannot be easily undone</li>
                </ul>
              </div>
              <button
                onClick={handlePurgeDatabase}
                disabled={purgingDatabase}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 whitespace-nowrap text-sm sm:flex-none"
              >
                <Database className="w-4 h-4" />
                {purgingDatabase ? 'Purging...' : 'Purge Database'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
