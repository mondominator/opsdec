import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogIn } from 'lucide-react';

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const from = location.state?.from?.pathname || '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
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

        {/* Login Form */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title flex items-center gap-2">
              <LogIn className="w-5 h-5" />
              Sign In
            </h2>
          </div>
          <div className="card-body">
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
                  placeholder="Enter your username"
                  required
                  autoFocus
                  autoComplete="username"
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
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn btn-primary py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in...' : 'Sign In'}
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

export default Login;
