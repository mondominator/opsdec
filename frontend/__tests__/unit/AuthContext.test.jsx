import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

// Use vi.hoisted so these are available when vi.mock factories run
const { mockApiGet, mockApiPost, mockAxiosGet } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockAxiosGet: vi.fn(),
}));

vi.mock('../../src/utils/api', () => ({
  default: {
    get: mockApiGet,
    post: mockApiPost,
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}));

vi.mock('axios', () => ({
  default: {
    get: mockAxiosGet,
    post: vi.fn(),
    defaults: { withCredentials: true },
  },
}));

import { useAuth, AuthProvider } from '../../src/contexts/AuthContext';

function wrapper({ children }) {
  return (
    <BrowserRouter>
      <AuthProvider>{children}</AuthProvider>
    </BrowserRouter>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('throws if useAuth is used outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within an AuthProvider');
    spy.mockRestore();
  });

  it('starts with loading=true then resolves to loading=false', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { setupRequired: false } });
    mockApiGet.mockResolvedValueOnce({ data: { user: null } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('sets setupRequired=true when API says no users exist', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { setupRequired: true } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.setupRequired).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it('fetches user when setup is not required', async () => {
    const mockUser = { id: 1, username: 'admin', is_admin: true };
    mockAxiosGet.mockResolvedValueOnce({ data: { setupRequired: false } });
    mockApiGet.mockResolvedValueOnce({ data: { user: mockUser } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.setupRequired).toBe(false);
  });

  it('login() calls API and sets user state', async () => {
    const mockUser = { id: 1, username: 'admin' };
    mockAxiosGet.mockResolvedValueOnce({ data: { setupRequired: false } });
    mockApiGet.mockResolvedValueOnce({ data: { user: null } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockApiPost.mockResolvedValueOnce({ data: { user: mockUser } });

    await act(async () => {
      await result.current.login('admin', 'password');
    });

    expect(mockApiPost).toHaveBeenCalledWith('/auth/login', {
      username: 'admin',
      password: 'password',
    });
    expect(result.current.user).toEqual(mockUser);
  });

  it('register() calls API, sets user state, clears setupRequired', async () => {
    const mockUser = { id: 1, username: 'newuser' };
    mockAxiosGet.mockResolvedValueOnce({ data: { setupRequired: true } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.setupRequired).toBe(true);

    mockApiPost.mockResolvedValueOnce({ data: { user: mockUser } });

    await act(async () => {
      await result.current.register('newuser', 'password', 'email@test.com');
    });

    expect(mockApiPost).toHaveBeenCalledWith('/auth/register', {
      username: 'newuser',
      password: 'password',
      email: 'email@test.com',
    });
    expect(result.current.user).toEqual(mockUser);
    expect(result.current.setupRequired).toBe(false);
  });

  it('logout() calls API and clears user state', async () => {
    const mockUser = { id: 1, username: 'admin' };
    mockAxiosGet.mockResolvedValueOnce({ data: { setupRequired: false } });
    mockApiGet.mockResolvedValueOnce({ data: { user: mockUser } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.user).toEqual(mockUser);
    });

    mockApiPost.mockResolvedValueOnce({});

    await act(async () => {
      await result.current.logout();
    });

    expect(mockApiPost).toHaveBeenCalledWith('/auth/logout');
    expect(result.current.user).toBeNull();
  });

  it('fetchUser() clears user on 401 error', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { setupRequired: false } });
    mockApiGet.mockResolvedValueOnce({ data: { user: { id: 1, username: 'admin' } } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.user).toBeTruthy();
    });

    mockApiGet.mockRejectedValueOnce({ response: { status: 401 } });

    await act(async () => {
      await result.current.fetchUser();
    });

    expect(result.current.user).toBeNull();
  });
});
