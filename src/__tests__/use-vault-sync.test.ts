import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVaultSync } from '../use-vault-sync';

const { mockBw, mockSaveCachedVault } = vi.hoisted(() => {
  const mockBw = {
    sync: vi.fn(),
    listItems: vi.fn(),
    listFolders: vi.fn(),
    getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
  };

  const mockSaveCachedVault = vi.fn().mockResolvedValue(undefined);

  return { mockBw, mockSaveCachedVault };
});

const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock('../bw-executor', () => ({
  ...mockBw,
  getErrorMessage: mockBw.getErrorMessage,
}));

vi.mock('../vault-cache', () => ({
  saveCachedVault: mockSaveCachedVault,
}));

vi.mock('@vicinae/api', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
  Toast: { Style: { Success: 'success', Failure: 'failure' } },
}));

const makeItems = () => [{ id: '1', name: 'GitHub', type: 1 }] as any[];
const makeFolders = () => [{ id: 'f1', name: 'Work' }] as any[];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useVaultSync', () => {
  describe('syncVault', () => {
    it('syncs, lists items/folders, caches, and sets vault', async () => {
      const items = makeItems();
      const folders = makeFolders();
      mockBw.sync.mockResolvedValue(undefined);
      mockBw.listItems.mockResolvedValue(items);
      mockBw.listFolders.mockResolvedValue(folders);
      const setVault = vi.fn();

      const { result } = renderHook(() => useVaultSync('token', setVault));

      await act(async () => {
        await result.current.syncVault('token');
      });

      expect(mockBw.sync).toHaveBeenCalledWith('token');
      expect(mockBw.listItems).toHaveBeenCalledWith('token');
      expect(mockBw.listFolders).toHaveBeenCalledWith('token');
      expect(mockSaveCachedVault).toHaveBeenCalledWith(items, folders);
      expect(setVault).toHaveBeenCalledWith(items, folders);
    });

    it('throws when sync fails', async () => {
      mockBw.sync.mockRejectedValue(new Error('sync error'));
      const setVault = vi.fn();

      const { result } = renderHook(() => useVaultSync('token', setVault));

      await expect(act(() => result.current.syncVault('token'))).rejects.toThrow('sync error');
    });
  });

  describe('handleSync', () => {
    it('sets isSyncing and shows success toast', async () => {
      mockBw.sync.mockResolvedValue(undefined);
      mockBw.listItems.mockResolvedValue(makeItems());
      mockBw.listFolders.mockResolvedValue(makeFolders());
      const setVault = vi.fn();

      const { result } = renderHook(() => useVaultSync('token', setVault));

      await act(async () => {
        await result.current.handleSync();
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: 'success', title: 'Vault synced' }),
      );
    });

    it('shows failure toast on sync error', async () => {
      mockBw.sync.mockRejectedValue(new Error('network error'));
      const setVault = vi.fn();

      const { result } = renderHook(() => useVaultSync('token', setVault));

      await act(async () => {
        await result.current.handleSync();
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: 'failure', title: 'Sync failed' }),
      );
    });

    it('resets isSyncing to false after completion', async () => {
      mockBw.sync.mockResolvedValue(undefined);
      mockBw.listItems.mockResolvedValue(makeItems());
      mockBw.listFolders.mockResolvedValue(makeFolders());
      const setVault = vi.fn();

      const { result } = renderHook(() => useVaultSync('token', setVault));

      expect(result.current.isSyncing).toBe(false);

      await act(async () => {
        await result.current.handleSync();
      });

      expect(result.current.isSyncing).toBe(false);
    });
  });
});
