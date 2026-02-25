import { useState, useRef } from 'react';
import { Camera, Save, Lock, Mail, AlertCircle, Check, Shield, Eye, EyeOff, Clock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { updateProfile, uploadAvatar, deleteAvatar, changePassword } from '../utils/api';
import { formatTimeAgo } from '../utils/format';

function StatusMessage({ message }) {
  if (!message) return null;
  const isSuccess = message.type === 'success';
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${isSuccess ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
      {isSuccess ? <Check className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
      {message.text}
    </div>
  );
}

export default function Profile() {
  const { user, fetchUser } = useAuth();
  const fileInputRef = useRef(null);

  // Email form
  const [email, setEmail] = useState(user?.email || '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMessage, setEmailMessage] = useState(null);

  // Avatar
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState(null);
  const [avatarKey, setAvatarKey] = useState(0);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState(null);

  const handleEmailSave = async () => {
    setSavingEmail(true);
    setEmailMessage(null);
    try {
      await updateProfile({ email: email || null });
      await fetchUser();
      setEmailMessage({ type: 'success', text: 'Email updated' });
    } catch (error) {
      setEmailMessage({ type: 'error', text: error.response?.data?.error || 'Failed to update email' });
    } finally {
      setSavingEmail(false);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAvatar(true);
    setAvatarMessage(null);
    try {
      await uploadAvatar(file);
      await fetchUser();
      setAvatarKey(k => k + 1);
      setAvatarMessage({ type: 'success', text: 'Avatar updated' });
    } catch (error) {
      setAvatarMessage({ type: 'error', text: error.response?.data?.error || 'Failed to upload avatar' });
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAvatarRemove = async () => {
    setUploadingAvatar(true);
    setAvatarMessage(null);
    try {
      await deleteAvatar();
      await fetchUser();
      setAvatarKey(k => k + 1);
      setAvatarMessage({ type: 'success', text: 'Avatar removed' });
    } catch (error) {
      setAvatarMessage({ type: 'error', text: error.response?.data?.error || 'Failed to remove avatar' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordMessage(null);

    if (newPassword.length < 8) {
      setPasswordMessage({ type: 'error', text: 'New password must be at least 8 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }

    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage({ type: 'success', text: 'Password changed successfully' });
    } catch (error) {
      setPasswordMessage({ type: 'error', text: error.response?.data?.error || 'Failed to change password' });
    } finally {
      setSavingPassword(false);
    }
  };

  const emailDirty = email !== (user?.email || '');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Profile Hero Card */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center gap-5">
            {/* Avatar with hover overlay */}
            <div className="relative group flex-shrink-0">
              {user?.avatar_url ? (
                <img
                  key={avatarKey}
                  src={`${user.avatar_url}?v=${avatarKey}`}
                  alt="Avatar"
                  className="w-20 h-20 rounded-xl object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-white text-3xl font-bold">
                  {user?.username?.charAt(0).toUpperCase()}
                </div>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute inset-0 rounded-xl bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
              >
                <Camera className="w-5 h-5 text-white" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </div>

            {/* Identity */}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-white">{user?.username}</h1>
              {user?.email && (
                <p className="text-sm text-gray-400 mt-0.5">{user.email}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {user?.is_admin ? (
                  <span className="px-2.5 py-0.5 bg-primary-500/20 text-primary-400 rounded-full text-xs font-medium border border-primary-500/30 flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Administrator
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 bg-dark-600 text-gray-400 rounded-full text-xs font-medium border border-dark-500">
                    User
                  </span>
                )}
                {user?.last_login && (
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Last login {formatTimeAgo(user.last_login)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Avatar actions row */}
          <div className="flex items-center gap-3 mt-4 pl-[100px]">
            {user?.avatar_url && (
              <button
                onClick={handleAvatarRemove}
                disabled={uploadingAvatar}
                className="text-xs text-gray-500 hover:text-red-400 disabled:opacity-50 transition-colors"
              >
                Remove photo
              </button>
            )}
            <span className="text-xs text-gray-600">Click avatar to change · JPG or PNG, max 2MB</span>
          </div>
          {avatarMessage && (
            <div className="mt-3">
              <StatusMessage message={avatarMessage} />
            </div>
          )}
        </div>
      </div>

      {/* Email Section */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Email Address</h2>
        </div>
        <div className="flex gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailMessage(null); }}
            placeholder="your@email.com"
            className="flex-1 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-primary-500 transition-colors"
          />
          <button
            onClick={handleEmailSave}
            disabled={savingEmail || !emailDirty}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:bg-dark-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors text-sm flex items-center gap-2"
          >
            <Save className="w-3.5 h-3.5" />
            {savingEmail ? 'Saving...' : 'Save'}
          </button>
        </div>
        {emailMessage && <div className="mt-3"><StatusMessage message={emailMessage} /></div>}
      </div>

      {/* Password Section */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Change Password</h2>
        </div>
        <div className="space-y-3">
          <div className="relative">
            <input
              type={showCurrentPassword ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => { setCurrentPassword(e.target.value); setPasswordMessage(null); }}
              placeholder="Current password"
              className="w-full px-3 py-2 pr-10 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-primary-500 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setPasswordMessage(null); }}
                placeholder="New password"
                className="w-full px-3 py-2 pr-10 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-primary-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <input
              type={showNewPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setPasswordMessage(null); }}
              placeholder="Confirm new password"
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>
          {newPassword && newPassword.length < 8 && (
            <p className="text-xs text-gray-500">Minimum 8 characters</p>
          )}
          <button
            onClick={handlePasswordChange}
            disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:bg-dark-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors text-sm flex items-center gap-2"
          >
            <Lock className="w-3.5 h-3.5" />
            {savingPassword ? 'Changing...' : 'Update Password'}
          </button>
          {passwordMessage && <StatusMessage message={passwordMessage} />}
        </div>
      </div>
    </div>
  );
}
