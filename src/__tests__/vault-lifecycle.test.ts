import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { useVaultLifecycle } from '../vault-lifecycle';
import type { UIState } from '../vault-lifecycle';
import type { BwItem, BwFolder } from '../bitwarden-types';

const { mockLoadFaviconCache, mockResolveFavicons, mockExtractHostname } = vi.hoisted(() => ({
  mockLoadFaviconCache: vi.fn().mockResolvedValue({}),
  mockResolveFavicons: vi.fn().mockResolvedValue({}),
  mockExtractHostname: vi.fn().mockReturnValue(null),
}));

const { mockLoadCachedVault } = vi.hoisted(() => ({
  mockLoadCachedVault: vi.fn().mockResolvedValue(null),
}));

const mockCheckBwGate = vi.hoisted(() => vi.fn());

const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock('../favicons', () => ({
  loadFaviconCache: mockLoadFaviconCache,
  resolveFavicons: mockResolveFavicons,
  extractHostname: mockExtractHostname,
}));

vi.mock('../vault-cache', () => ({
  loadCachedVault: mockLoadCachedVault,
}));

vi.mock('../unlock-gate', () => ({
  checkBwGate: mockCheckBwGate,
}));

vi.mock('@vicinae/api', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
  Toast: { Style: { Success: 'success', Failure: 'failure' } },
}));

function makeParams(
  overrides: Partial<{
    session: string | null;
    state: UIState;
    setState: React.Dispatch<React.SetStateAction<UIState>>;
    setVault: (items: BwItem[], folders: BwFolder[]) => void;
    syncVault: (token: string) => Promise<void>;
    handleLogin: () => Promise<void>;
    clearSession: () => Promise<void>;
    setFaviconMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  }> = {},
) {
  return {
    session: null,
    state: { kind: 'checking-bw' } as UIState,
    setState: vi.fn() as unknown as React.Dispatch<React.SetStateAction<UIState>>,
    setVault: vi.fn(),
    syncVault: vi.fn().mockResolvedValue(undefined),
    handleLogin: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined),
    setFaviconMap: vi.fn() as unknown as React.Dispatch<
      React.SetStateAction<Record<string, string>>
    >,
    ...overrides,
  };
}

const makeItems = (): BwItem[] => [{ id: '1', name: 'A', type: 1 } as unknown as BwItem];
const makeFolders = (): BwFolder[] => [{ id: 'f1', name: 'Work' }];

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckBwGate.mockReset();
  mockCheckBwGate.mockResolvedValue({ kind: 'ready' });
  mockLoadCachedVault.mockResolvedValue(null);
  mockLoadFaviconCache.mockResolvedValue({});
  mockResolveFavicons.mockResolvedValue({});
  mockShowToast.mockClear();
});

describe('useVaultLifecycle', () => {
  // -------------------------------------------------------------------------
  // Initial mount (checking-bw → ready path)
  // -------------------------------------------------------------------------
  describe('initial mount: ready path', () => {
    it('loads favicon cache on mount', async () => {
      mockCheckBwGate.mockResolvedValue({ kind: 'ready' });
      const setFaviconMap = vi.fn();
      mockLoadFaviconCache.mockResolvedValue({ 'test.com': 'data:...' });

      const params = makeParams({ session: 'token', setFaviconMap });
      renderHook(() => useVaultLifecycle(params));

      await waitFor(() => {
        expect(mockLoadFaviconCache).toHaveBeenCalled();
        expect(setFaviconMap).toHaveBeenCalledWith({ 'test.com': 'data:...' });
      });
    });

    it('caches vault data when cached in storage', async () => {
      mockCheckBwGate.mockResolvedValue({ kind: 'ready' });
      const cached = { items: makeItems(), folders: makeFolders() };
      mockLoadCachedVault.mockResolvedValue(cached);
      const setVault = vi.fn();

      const params = makeParams({ session: 'token', setVault });
      renderHook(() => useVaultLifecycle(params));

      await waitFor(() => {
        expect(setVault).toHaveBeenCalledWith(cached.items, cached.folders);
      });
    });

    it('syncs vault after gate ready', async () => {
      mockCheckBwGate.mockResolvedValue({ kind: 'ready' });
      const syncVault = vi.fn().mockResolvedValue(undefined);

      const params = makeParams({ session: 'token', syncVault });
      renderHook(() => useVaultLifecycle(params));

      await waitFor(() => {
        expect(syncVault).toHaveBeenCalledWith('token');
        expect(mockShowToast).toHaveBeenCalledWith(
          expect.objectContaining({ style: 'success', title: 'Vault synced' }),
        );
      });
    });

    it('falls back to cached vault on sync failure', async () => {
      mockCheckBwGate.mockResolvedValue({ kind: 'ready' });
      const cached = { items: makeItems(), folders: makeFolders() };
      mockLoadCachedVault.mockResolvedValue(cached);
      const syncVault = vi.fn().mockRejectedValue(new Error('network'));
      const setVault = vi.fn();
      const clearSession = vi.fn();

      const params = makeParams({ session: 'token', syncVault, setVault, clearSession });
      renderHook(() => useVaultLifecycle(params));

      await waitFor(() => {
        expect(setVault).toHaveBeenCalledWith(cached.items, cached.folders);
      });
      expect(clearSession).not.toHaveBeenCalled();
    });

    it('clears session and sets needs-unlock on sync failure with no cache', async () => {
      mockCheckBwGate.mockResolvedValue({ kind: 'ready' });
      mockLoadCachedVault.mockResolvedValue(null);
      const syncVault = vi.fn().mockRejectedValue(new Error('expired'));
      const clearSession = vi.fn();
      const setState = vi.fn();

      const params = makeParams({ session: 'token', syncVault, clearSession, setState });
      renderHook(() => useVaultLifecycle(params));

      await waitFor(() => {
        expect(clearSession).toHaveBeenCalled();
        expect(setState).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'needs-unlock', error: 'Session expired' }),
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // Initial mount: gate states
  // -------------------------------------------------------------------------
  describe('initial mount: gate states', () => {
    it('sets bw-not-installed state', async () => {
      mockCheckBwGate.mockResolvedValue({ kind: 'bw-not-installed' });
      const setState = vi.fn();

      const params = makeParams({ setState });
      renderHook(() => useVaultLifecycle(params));

      await waitFor(() => {
        expect(setState).toHaveBeenCalledWith({ kind: 'bw-not-installed' });
      });
    });

    it('sets secret-tool-not-installed state', async () => {
      mockCheckBwGate.mockResolvedValue({ kind: 'secret-tool-not-installed' });
      const setState = vi.fn();

      const params = makeParams({ setState });
      renderHook(() => useVaultLifecycle(params));

      await waitFor(() => {
        expect(setState).toHaveBeenCalledWith({ kind: 'secret-tool-not-installed' });
      });
    });

    it('sets logging-in state', async () => {
      mockCheckBwGate.mockResolvedValue({ kind: 'logging-in' });
      const setState = vi.fn();

      const params = makeParams({ setState });
      renderHook(() => useVaultLifecycle(params));

      await waitFor(() => {
        expect(setState).toHaveBeenCalledWith({ kind: 'logging-in' });
      });
    });

    it('sets needs-unlock when no session and no cache', async () => {
      mockCheckBwGate.mockResolvedValue({ kind: 'needs-unlock' });
      mockLoadCachedVault.mockResolvedValue(null);
      const setState = vi.fn();

      const params = makeParams({ setState });
      renderHook(() => useVaultLifecycle(params));

      await waitFor(() => {
        expect(setState).toHaveBeenCalledWith({ kind: 'needs-unlock' });
      });
    });

    it('suppresses needs-unlock when cache exists (shows stale data)', async () => {
      mockCheckBwGate.mockResolvedValue({ kind: 'needs-unlock' });
      const cached = { items: makeItems(), folders: makeFolders() };
      mockLoadCachedVault.mockResolvedValue(cached);
      const setState = vi.fn();
      const setVault = vi.fn();

      const params = makeParams({ setState, setVault });
      renderHook(() => useVaultLifecycle(params));

      await waitFor(() => {
        expect(setVault).toHaveBeenCalledWith(cached.items, cached.folders);
      });
      expect(setState).not.toHaveBeenCalledWith({ kind: 'needs-unlock' });
    });
  });

  // -------------------------------------------------------------------------
  // Session arrival transitions needs-unlock → loading
  // -------------------------------------------------------------------------
  it('transitions needs-unlock to loading when session arrives', () => {
    mockCheckBwGate.mockResolvedValue({ kind: 'needs-unlock' });
    mockLoadCachedVault.mockResolvedValue(null);
    const setState = vi.fn();

    const { rerender } = renderHook(
      (state) => useVaultLifecycle(makeParams({ session: 'token', state, setState })),
      { initialProps: { kind: 'checking-bw' } as UIState },
    );

    rerender({ kind: 'needs-unlock' } as UIState);

    expect(setState).toHaveBeenCalledWith({ kind: 'loading' });
  });

  it('does not transition non-needs-unlock states on session arrival', () => {
    mockCheckBwGate.mockResolvedValue({ kind: 'ready' });
    mockLoadCachedVault.mockResolvedValue({ items: makeItems(), folders: makeFolders() });
    const setState = vi.fn();

    const { rerender } = renderHook(
      (state) => useVaultLifecycle(makeParams({ session: 'token', state, setState })),
      { initialProps: { kind: 'vault', items: [], folders: [] } as UIState },
    );

    rerender({ kind: 'vault', items: makeItems(), folders: makeFolders() } as UIState);

    expect(setState).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // loading state → sync vault
  // -------------------------------------------------------------------------
  it('syncs vault when state transitions to loading with session', async () => {
    mockCheckBwGate.mockResolvedValue({ kind: 'ready' });
    mockLoadCachedVault.mockResolvedValue(null);
    const syncVault = vi.fn().mockResolvedValue(undefined);
    const setVault = vi.fn();
    const cached = { items: makeItems(), folders: makeFolders() };
    mockLoadCachedVault.mockImplementationOnce(async () => null).mockResolvedValueOnce(cached);

    const { rerender } = renderHook(
      (state) => useVaultLifecycle(makeParams({ session: 'token', state, setVault, syncVault })),
      { initialProps: { kind: 'needs-unlock' } as UIState },
    );

    rerender({ kind: 'loading' } as UIState);

    await waitFor(() => {
      expect(syncVault).toHaveBeenCalledWith('token');
    });
  });

  it('shows failure toast and clears session on loading sync failure without cache', async () => {
    mockCheckBwGate.mockResolvedValue({ kind: 'ready' });
    mockLoadCachedVault.mockResolvedValue(null);
    const syncVault = vi.fn().mockRejectedValue(new Error('network down'));
    const setState = vi.fn();
    const clearSession = vi.fn();

    const { rerender } = renderHook(
      (state) =>
        useVaultLifecycle(
          makeParams({ session: 'token', state, syncVault, clearSession, setState }),
        ),
      { initialProps: { kind: 'checking-bw' } as UIState },
    );

    rerender({ kind: 'loading' } as UIState);

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalled();
      expect(setState).toHaveBeenCalledWith(expect.objectContaining({ kind: 'needs-unlock' }));
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: 'failure', title: 'Failed to load vault' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // logging-in state triggers handleLogin
  // -------------------------------------------------------------------------
  it('calls handleLogin when state transitions to logging-in', async () => {
    mockCheckBwGate.mockResolvedValue({ kind: 'ready' });
    const handleLogin = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      (state) => useVaultLifecycle(makeParams({ state, handleLogin })),
      { initialProps: { kind: 'checking-bw' } as UIState },
    );

    rerender({ kind: 'logging-in' } as UIState);

    await waitFor(() => {
      expect(handleLogin).toHaveBeenCalled();
    });
  });

  it('does not call handleLogin when state is not logging-in', async () => {
    const handleLogin = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useVaultLifecycle(makeParams({ state: { kind: 'needs-unlock' }, handleLogin })),
    );

    expect(handleLogin).not.toHaveBeenCalled();
  });
});
