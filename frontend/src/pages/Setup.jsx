import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { UserPlus, Shield } from 'lucide-react';

function Setup() {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (username.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    setLoading(true);

    try {
      await register(username, password, email || undefined);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <img src="/logo-icon.svg" alt="OpsDec" className="w-16 h-16" />
          </div>
          <h1 className="text-2xl font-bold">
            <span className="text-white">Ops</span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">Dec</span>
          </h1>
          <p className="text-gray-400 mt-2">Media Server Monitoring</p>
        </div>

        {/* Setup Form */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Create Admin Account
            </h2>
          </div>
          <div className="card-body">
            <div className="flex items-center gap-2 bg-primary-500/10 border border-primary-500/30 text-primary-400 px-4 py-2 rounded text-sm mb-4">
              <Shield className="w-4 h-4 flex-shrink-0" />
              <span>This account will have administrator privileges.</span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-2 rounded text-sm">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
                  placeholder="Choose a username"
                  required
                  autoFocus
                  minLength={3}
                  autoComplete="username"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">
                  Email <span className="text-gray-500">(optional)</span>
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
                  placeholder="your@email.com"
                  autoComplete="email"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
                  placeholder="Confirm your password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn btn-primary py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating Account...' : 'Create Admin Account'}
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-gray-500 text-sm mt-6">
          OpsDec v0.1.0
        </p>
      </div>
    </div>
  );
}

export default Setup;
