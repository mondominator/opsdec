import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
}));

// Mock AuthContext - both the provider and the hook
vi.mock('../src/contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: mockUseAuth,
  default: {},
}));

// Mock TimezoneContext
vi.mock('../src/contexts/TimezoneContext', () => ({
  TimezoneProvider: ({ children }) => children,
}));

// Mock page components with simple identifiable content
vi.mock('../src/pages/Dashboard', () => ({
  default: () => <div data-testid="dashboard-page">Dashboard</div>,
}));
vi.mock('../src/pages/History', () => ({
  default: () => <div data-testid="history-page">History</div>,
}));
vi.mock('../src/pages/Users', () => ({
  default: () => <div data-testid="users-page">Users</div>,
}));
vi.mock('../src/pages/UserDetails', () => ({
  default: () => <div data-testid="user-details-page">UserDetails</div>,
}));
vi.mock('../src/pages/Settings', () => ({
  default: () => <div data-testid="settings-page">Settings</div>,
}));
vi.mock('../src/pages/Login', () => ({
  default: () => <div data-testid="login-page">Login</div>,
}));
vi.mock('../src/pages/Setup', () => ({
  default: () => <div data-testid="setup-page">Setup</div>,
}));
vi.mock('../src/components/Layout', () => ({
  default: ({ children }) => <div data-testid="layout">{children}</div>,
}));

// Replace BrowserRouter with MemoryRouter so we can control the initial route
const { mockInitialEntries } = vi.hoisted(() => ({
  mockInitialEntries: { value: ['/'] },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    BrowserRouter: ({ children }) => (
      <actual.MemoryRouter initialEntries={mockInitialEntries.value}>
        {children}
      </actual.MemoryRouter>
    ),
  };
});

import App from '../src/App';

describe('App routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitialEntries.value = ['/'];
    cleanup();
  });

  it('renders Login page at /login when not authenticated', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, setupRequired: false });
    mockInitialEntries.value = ['/login'];

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
  });

  it('renders Setup page at /setup when setup required', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, setupRequired: true });
    mockInitialEntries.value = ['/setup'];

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('setup-page')).toBeInTheDocument();
    });
  });

  it('redirects unauthenticated users away from protected routes', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, setupRequired: false });
    mockInitialEntries.value = ['/'];

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
  });

  it('renders Dashboard at / when authenticated', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, username: 'admin', is_admin: true },
      loading: false,
      setupRequired: false,
    });
    mockInitialEntries.value = ['/'];

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });

  it('redirects unknown routes to /', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, username: 'admin', is_admin: true },
      loading: false,
      setupRequired: false,
    });
    mockInitialEntries.value = ['/nonexistent'];

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });

  it('redirects authenticated user from /login to /', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, username: 'admin', is_admin: true },
      loading: false,
      setupRequired: false,
    });
    mockInitialEntries.value = ['/login'];

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });
});

describe('ProtectedRoute behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitialEntries.value = ['/'];
    cleanup();
  });

  it('shows loading state while auth is loading', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, setupRequired: false });
    mockInitialEntries.value = ['/'];

    render(<App />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
  });

  it('redirects to /setup when setupRequired on protected route', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, setupRequired: true });
    mockInitialEntries.value = ['/'];

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('setup-page')).toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
    });
  });

  it('renders protected content for authenticated admin', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, username: 'admin', is_admin: true },
      loading: false,
      setupRequired: false,
    });
    mockInitialEntries.value = ['/settings'];

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    });
  });
});
