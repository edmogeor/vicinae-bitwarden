import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSession } from '../use-session';

const { mockBw, mockSessionStore, mockApiCredStore } = vi.hoisted(() => {
  const mockBw = {
    login: vi.fn().mockResolvedValue(undefined),
    unlock: vi.fn().mockResolvedValue('default-token'),
    lock: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
  };

  const mockSessionStore = {
    getSession: vi.fn().mockResolvedValue(null),
    setSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  };

  const mockApiCredStore = {
    getApiCredentials: vi.fn().mockResolvedValue(null),
    storeApiCredentials: vi.fn().mockResolvedValue(undefined),
    clearApiCredentialsFromDisk: vi.fn().mockResolvedValue(undefined),
  };

  return { mockBw, mockSessionStore, mockApiCredStore };
});

vi.mock('../session-store', () => mockSessionStore);

vi.mock('../api-credential-store', () => mockApiCredStore);

vi.mock('@vicinae/api', () => ({
  showToast: vi.fn(),
  Toast: { Style: { Success: 'success', Failure: 'failure', Animated: 'animated' } },
}));

vi.mock('../bw-executor', () => mockBw);

vi.mock('../preferences', () => ({
  getPreferences: () => ({
    serverRegion: 'bitwarden.com' as const,
    customServerUrl: '',
    apiClientId: 'test-client-id',
    apiClientSecret: 'test-client-secret',
    autoLockTimeout: '21600',
    downloadDir: '',
    passwordLength: '20',
    passwordUppercase: true,
    passwordLowercase: true,
    passwordNumbers: true,
    passwordSymbols: true,
  }),
  getServerUrl: () => 'https://bitwarden.com',
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionStore.getSession.mockResolvedValue(null);
  mockBw.sync.mockResolvedValue(undefined);
  mockBw.unlock.mockResolvedValue('default-token');
  mockBw.lock.mockResolvedValue(undefined);
  mockBw.login.mockResolvedValue(undefined);
});

describe('useSession', () => {
  describe('initial mount', () => {
    it('has null session when no cached session exists', async () => {
      mockSessionStore.getSession.mockResolvedValue(null);

      const { result } = renderHook(() => useSession());

      expect(result.current.session).toBeNull();
    });

    it('loads cached session from session store', async () => {
      mockSessionStore.getSession.mockResolvedValue('cached-token');

      const { result } = renderHook(() => useSession());

      await waitFor(() => {
        expect(result.current.session).toBe('cached-token');
      });
    });
  });

  describe('unlock', () => {
    it('calls bw.unlock, stores session, and updates state', async () => {
      mockSessionStore.getSession.mockResolvedValue(null);
      mockBw.unlock.mockResolvedValue('new-session-token');

      const { result } = renderHook(() => useSession());

      await act(async () => {
        const token = await result.current.unlock('mypassword');
        expect(token).toBe('new-session-token');
      });

      expect(mockBw.unlock).toHaveBeenCalledWith('mypassword');
      expect(mockSessionStore.setSession).toHaveBeenCalledWith('new-session-token');
      expect(result.current.session).toBe('new-session-token');
    });

    it('propagates unlock errors', async () => {
      mockSessionStore.getSession.mockResolvedValue(null);
      mockBw.unlock.mockRejectedValue(new Error('Invalid master password'));

      const { result } = renderHook(() => useSession());

      await expect(act(() => result.current.unlock('wrong'))).rejects.toThrow(
        'Invalid master password',
      );

      expect(result.current.session).toBeNull();
      expect(mockSessionStore.setSession).not.toHaveBeenCalled();
    });
  });

  describe('clearSession', () => {
    async function renderAndClear() {
      const { result } = renderHook(() => useSession());

      await waitFor(() => {
        expect(result.current.session).toBe('active-token');
      });

      await act(async () => {
        await result.current.clearSession();
      });

      return result;
    }

    it('calls bw.lock, deletes session, and sets session to null', async () => {
      mockSessionStore.getSession.mockResolvedValue('active-token');
      mockBw.sync.mockResolvedValue(undefined);

      const result = await renderAndClear();

      expect(mockBw.lock).toHaveBeenCalledWith('active-token');
      expect(mockSessionStore.deleteSession).toHaveBeenCalledOnce();
      expect(result.current.session).toBeNull();
    });

    it('clears session even when bw.lock fails', async () => {
      mockSessionStore.getSession.mockResolvedValue('active-token');
      mockBw.sync.mockResolvedValue(undefined);
      mockBw.lock.mockRejectedValue(new Error('already locked'));

      const result = await renderAndClear();

      expect(result.current.session).toBeNull();
      expect(mockSessionStore.deleteSession).toHaveBeenCalledOnce();
    });

    it('deletes session even when session is null', async () => {
      mockSessionStore.getSession.mockResolvedValue(null);

      const { result } = renderHook(() => useSession());

      await act(async () => {
        await result.current.clearSession();
      });

      expect(mockBw.lock).not.toHaveBeenCalled();
      expect(mockSessionStore.deleteSession).toHaveBeenCalledOnce();
      expect(result.current.session).toBeNull();
    });
  });

  describe('loginIfNeeded', () => {
    it('uses libsecret credentials when available and prefs unchanged', async () => {
      mockSessionStore.getSession.mockResolvedValue(null);
      mockApiCredStore.getApiCredentials.mockResolvedValue({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      });

      const { result } = renderHook(() => useSession());

      await act(async () => {
        await result.current.loginIfNeeded();
      });

      expect(mockBw.login).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          serverUrl: 'https://bitwarden.com',
        }),
      );
      expect(mockApiCredStore.storeApiCredentials).not.toHaveBeenCalled();
    });

    it('uses preferences and migrates to libsecret when no libsecret creds exist', async () => {
      mockSessionStore.getSession.mockResolvedValue(null);
      mockApiCredStore.getApiCredentials.mockResolvedValue(null);

      const { result } = renderHook(() => useSession());

      await act(async () => {
        await result.current.loginIfNeeded();
      });

      expect(mockBw.login).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          serverUrl: 'https://bitwarden.com',
        }),
      );
      expect(mockApiCredStore.storeApiCredentials).toHaveBeenCalledWith(
        'test-client-id',
        'test-client-secret',
      );
      expect(mockApiCredStore.clearApiCredentialsFromDisk).toHaveBeenCalled();
    });

    it('detects credential rotation and re-migrates', async () => {
      mockSessionStore.getSession.mockResolvedValue(null);
      mockApiCredStore.getApiCredentials.mockResolvedValue({
        clientId: 'old-rotated-id',
        clientSecret: 'old-rotated-secret',
      });

      const { result } = renderHook(() => useSession());

      await act(async () => {
        await result.current.loginIfNeeded();
      });

      expect(mockBw.login).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          serverUrl: 'https://bitwarden.com',
        }),
      );
      expect(mockApiCredStore.storeApiCredentials).toHaveBeenCalledWith(
        'test-client-id',
        'test-client-secret',
      );
      expect(mockApiCredStore.clearApiCredentialsFromDisk).toHaveBeenCalled();
    });

    it('isLoggingIn is false after login completes', async () => {
      mockSessionStore.getSession.mockResolvedValue(null);
      mockBw.login.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSession());

      await act(async () => {
        await result.current.loginIfNeeded();
      });

      expect(result.current.isLoggingIn).toBe(false);
    });
  });
});
