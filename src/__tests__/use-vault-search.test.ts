import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVaultSearch } from '../use-vault-search';

const mockClipboardCopy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockShowToast = vi.hoisted(() => vi.fn());
const mockGetTotp = vi.hoisted(() => vi.fn());
const mockGetErrorMessage = vi.hoisted(() =>
  vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
);

vi.mock('../bw-executor', () => ({
  getTotp: mockGetTotp,
  getErrorMessage: mockGetErrorMessage,
}));

vi.mock('../item-utils', () => ({
  filterItems: (items: unknown[]) => items,
  groupByFolder: (items: unknown[]) => {
    const map = new Map();
    if ((items as any[]).length > 0) {
      map.set('f1', { folderName: 'Work', items });
    }
    return map;
  },
}));

let mockSession: string | null = 'token';
let mockIsSyncing = false;
let mockGateRender: React.ReactElement | null = null;

vi.mock('../use-session', () => ({
  useSession: () => ({
    session: mockSession,
    unlock: vi.fn(),
    clearSession: vi.fn(),
    loginIfNeeded: vi.fn(),
    loginError: null,
  }),
}));

vi.mock('../use-vault-sync', () => ({
  useVaultSync: () => ({
    syncVault: vi.fn(),
    handleSync: vi.fn(),
    isSyncing: mockIsSyncing,
  }),
}));

vi.mock('../vault-lifecycle', () => ({
  useVaultLifecycle: vi.fn(),
}));

vi.mock('../unlock-gate', () => ({
  createUnlockCallbacks: () => ({
    onUnlockStart: vi.fn(),
    onUnlockReady: vi.fn(),
    onUnlockError: vi.fn(),
    onLoginReady: vi.fn(),
    onLoginError: vi.fn(),
  }),
  renderGate: () => mockGateRender,
  useUnlockGate: () => ({
    handleLogin: vi.fn(),
    handleUnlock: vi.fn(),
  }),
}));

vi.mock('@vicinae/api', () => ({
  Clipboard: { copy: (...args: unknown[]) => mockClipboardCopy(...args) },
  showToast: (...args: unknown[]) => mockShowToast(...args),
  Toast: { Style: { Success: 'success', Failure: 'failure' } },
}));

import { useVaultLifecycle as mockUseVaultLifecycle } from '../vault-lifecycle';

beforeEach(() => {
  vi.clearAllMocks();
  mockSession = 'token';
  mockIsSyncing = false;
  mockGateRender = null;
  vi.mocked(mockUseVaultLifecycle).mockImplementation((params: any) => {
    const { useEffect } = require('react');
    useEffect(() => {
      params.setFaviconMap({});
      params.setState({
        kind: 'vault',
        items: [{ id: '1', name: 'GitHub', type: 1, login: { username: 'user' } }],
        folders: [{ id: 'f1', name: 'Work' }],
      });
      params.setVault(
        [{ id: '1', name: 'GitHub', type: 1, login: { username: 'user' } }],
        [{ id: 'f1', name: 'Work' }],
      );
    }, []);
  });
});

describe('useVaultSearch', () => {
  describe('handleCopyTotp', () => {
    it('copies TOTP and shows success toast', async () => {
      mockGetTotp.mockResolvedValue('123456');

      const { result } = renderHook(() => useVaultSearch());

      await act(async () => {
        await result.current.handleCopyTotp('item-1');
      });

      expect(mockGetTotp).toHaveBeenCalledWith('item-1', 'token');
      expect(mockClipboardCopy).toHaveBeenCalledWith('123456');
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: 'success', title: 'Copied TOTP' }),
      );
    });

    it('shows failure toast when getTotp fails', async () => {
      mockGetTotp.mockRejectedValue(new Error('TOTP error'));

      const { result } = renderHook(() => useVaultSearch());

      await act(async () => {
        await result.current.handleCopyTotp('item-1');
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: 'failure', title: 'Failed to get TOTP' }),
      );
    });
  });

  describe('isLoading', () => {
    it('is true when state kind is checking-bw', () => {
      vi.mocked(mockUseVaultLifecycle).mockImplementation(() => {});
      const { result } = renderHook(() => useVaultSearch());
      expect(result.current.isLoading).toBe(true);
    });

    it('is true when syncing', async () => {
      mockIsSyncing = true;
      const { result } = renderHook(() => useVaultSearch());
      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });
    });

    it('is false when vault is loaded and not syncing', async () => {
      const { result } = renderHook(() => useVaultSearch());
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('preFilter', () => {
    it('applies preFilter to vault items before search', async () => {
      const preFilter = (items: any[]) => items.filter((i: any) => i.login?.username === 'user');

      const { result } = renderHook(() => useVaultSearch(preFilter));

      await waitFor(() => {
        expect(result.current.filtered).toHaveLength(1);
        expect(result.current.sortedSections).toHaveLength(1);
      });
    });

    it('returns all items when no preFilter provided', async () => {
      const { result } = renderHook(() => useVaultSearch());

      await waitFor(() => {
        expect(result.current.filtered).toHaveLength(1);
      });
    });
  });

  describe('sortedSections', () => {
    it('returns sorted sections by folder name', async () => {
      const { result } = renderHook(() => useVaultSearch());

      await waitFor(() => {
        expect(result.current.sortedSections).toHaveLength(1);
        expect(result.current.sortedSections[0][0]).toBe('f1');
        expect(result.current.sortedSections[0][1].folderName).toBe('Work');
      });
    });
  });
});
