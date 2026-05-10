import { Action, ActionPanel, Clipboard, Icon, List, showToast, Toast } from '@vicinae/api';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as bw from './bw-executor';
import { getErrorMessage } from './bw-executor';
import { filterItems, formatTotp, groupByFolder, itemIcon, itemSubtitle } from './item-utils';
import { loadCachedVault } from './vault-cache';
import { useSession } from './use-session';
import { checkBwGate, createUnlockCallbacks, renderGate, useUnlockGate } from './unlock-gate';
import { useVaultSync } from './use-vault-sync';
import { extractHostname, loadFaviconCache, resolveFavicons } from './favicons';
import type { BwFolder, BwItem } from './bitwarden-types';
import { ItemType } from './bitwarden-types';

type UIState =
  | { kind: 'checking-bw' }
  | { kind: 'bw-not-installed' }
  | { kind: 'secret-tool-not-installed' }
  | { kind: 'logging-in' }
  | { kind: 'login-failed'; error: string }
  | { kind: 'needs-unlock'; error?: string }
  | { kind: 'unlocking' }
  | { kind: 'loading' }
  | { kind: 'vault'; items: BwItem[]; folders: BwFolder[] };

function totpItems(items: BwItem[]): BwItem[] {
  return items.filter(
    (item) =>
      item.type === ItemType.Login && item.login?.totp !== null && item.login?.totp !== undefined,
  );
}

export default function SearchTotp() {
  const { session, unlock, clearSession, loginIfNeeded, loginError } = useSession();
  const [state, setState] = useState<UIState>({ kind: 'checking-bw' });

  const setVault = (items: BwItem[], folders: BwFolder[]) => {
    setState({ kind: 'vault', items, folders });
  };

  const [searchText, setSearchText] = useState('');
  const [faviconMap, setFaviconMap] = useState<Record<string, string>>({});
  const [totpMap, setTotpMap] = useState<Record<string, string>>({});
  const [countdown, setCountdown] = useState(30 - (Math.floor(Date.now() / 1000) % 30));

  const { handleLogin, handleUnlock } = useUnlockGate({
    loginIfNeeded,
    loginError,
    unlock,
    ...createUnlockCallbacks(setState, () => setState({ kind: 'loading' })),
  });

  const { syncVault, handleSync, isSyncing } = useVaultSync(session, setVault);

  // TOTP countdown tick
  useEffect(() => {
    const tick = () => setCountdown(30 - (Math.floor(Date.now() / 1000) % 30));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  // Step 1: Load cached vault, favicons, run bw checks
  useEffect(() => {
    void (async () => {
      const map = await loadFaviconCache();
      setFaviconMap(map);

      const cached = await loadCachedVault();
      if (cached) {
        setVault(cached.items, cached.folders);
      }

      const gate = await checkBwGate(session);
      switch (gate.kind) {
        case 'bw-not-installed':
        case 'secret-tool-not-installed':
        case 'logging-in':
          setState({ kind: gate.kind });
          return;
        case 'needs-unlock':
          if (!cached) setState({ kind: 'needs-unlock' });
          return;
        case 'ready':
          break;
      }

      try {
        await syncVault(session!);
        await showToast({ style: Toast.Style.Success, title: 'Vault synced' });
      } catch {
        if (!cached) {
          await clearSession();
          setState({ kind: 'needs-unlock', error: 'Session expired' });
        }
      }
    })();
  }, []);

  // When session resolves after mount while on needs-unlock
  useEffect(() => {
    if (!session) return;
    if (state.kind !== 'needs-unlock') return;
    setState({ kind: 'loading' });
  }, [session, state.kind]);

  // When session appears while vault is already showing
  useEffect(() => {
    if (!session) return;
    if (state.kind !== 'vault') return;
    void (async () => {
      try {
        await syncVault(session);
        await showToast({ style: Toast.Style.Success, title: 'Vault synced' });
      } catch {
        // Cache already showing — silent fail
      }
    })();
  }, [session]);

  // Resolve favicons when vault appears
  useEffect(() => {
    if (state.kind !== 'vault') return;
    const domains: string[] = [];
    for (const item of state.items) {
      if (item.type !== ItemType.Login) continue;
      const hostname = extractHostname(item.login?.uris);
      if (hostname) domains.push(hostname);
    }
    if (domains.length === 0) return;
    let mounted = true;
    void (async () => {
      const map = await resolveFavicons(domains);
      if (mounted) setFaviconMap(map);
    })();
    return () => {
      mounted = false;
    };
  }, [state]);

  // When state becomes "loading" and session is available
  useEffect(() => {
    if (!session) return;
    if (state.kind !== 'loading') return;
    void (async () => {
      const cached = await loadCachedVault();
      if (cached) {
        setVault(cached.items, cached.folders);
      }
      try {
        await syncVault(session);
      } catch (err) {
        if (!cached) {
          const message = getErrorMessage(err);
          await showToast({ style: Toast.Style.Failure, title: 'Failed to load vault', message });
          await clearSession();
          setState({ kind: 'needs-unlock', error: message });
        }
      }
    })();
  }, [session, state.kind]);

  // When login is needed
  useEffect(() => {
    if (state.kind !== 'logging-in') return;
    void handleLogin();
  }, [state.kind]);

  // Fetch TOTP codes when session is available and vault is loaded
  useEffect(() => {
    if (!session) return;
    if (state.kind !== 'vault') return;
    const ids = totpItems(state.items).map((i) => i.id);

    const fetchCodes = async () => {
      const results = await Promise.allSettled(ids.map((id) => bw.getTotp(id, session)));
      const map: Record<string, string> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') map[ids[i]] = r.value;
      });
      setTotpMap(map);
    };

    fetchCodes();
    const interval = setInterval(fetchCodes, 30_000);
    return () => clearInterval(interval);
  }, [session, state.kind === 'vault' ? state.items.length : 0]);

  // --- Derived data ---
  const vaultItems = state.kind === 'vault' ? state.items : [];
  const vaultFolders = state.kind === 'vault' ? state.folders : [];

  const onlyTotp = useMemo(() => totpItems(vaultItems), [vaultItems]);
  const filtered = useMemo(() => filterItems(onlyTotp, searchText), [onlyTotp, searchText]);
  const grouped = useMemo(() => groupByFolder(filtered, vaultFolders), [filtered, vaultFolders]);

  const handleCopyTotp = useCallback(
    async (id: string) => {
      if (!session) return;
      try {
        const totp = await bw.getTotp(id, session);
        await Clipboard.copy(totp);
        await showToast({ style: Toast.Style.Success, title: 'Copied TOTP' });
      } catch (err) {
        const message = getErrorMessage(err);
        await showToast({
          style: Toast.Style.Failure,
          title: 'Failed to get TOTP',
          message,
        });
      }
    },
    [session],
  );

  // --- Render ---
  const gateRender = renderGate(state, handleUnlock, handleLogin);
  if (gateRender) return gateRender;

  const isLoading =
    state.kind === 'checking-bw' ||
    state.kind === 'logging-in' ||
    state.kind === 'loading' ||
    isSyncing;

  const sortedSections = [...grouped.entries()].sort(([, a], [, b]) =>
    a.folderName.localeCompare(b.folderName),
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={state.kind === 'vault' ? setSearchText : undefined}
      searchBarPlaceholder="Search accounts with TOTP..."
      throttle
    >
      {state.kind === 'vault' ? (
        sortedSections.length === 0 ? (
          <List.EmptyView
            title={searchText ? 'No matching items' : 'No TOTP accounts'}
            description={
              searchText
                ? 'Try a different search or Sync to refresh'
                : 'No accounts with TOTP set up in your vault'
            }
          />
        ) : (
          sortedSections.map(([folderId, { folderName, items: sectionItems }]) => (
            <List.Section key={folderId ?? 'unfiled'} title={folderName}>
              {sectionItems.map((item) => {
                const code = totpMap[item.id];
                return (
                  <List.Item
                    key={item.id}
                    icon={itemIcon(item, faviconMap)}
                    title={item.name}
                    subtitle={itemSubtitle(item)}
                    accessories={
                      code
                        ? [{ text: formatTotp(code) }, { text: `(${countdown}s)` }]
                        : [{ text: 'Loading...' }]
                    }
                    actions={
                      <ActionPanel>
                        <Action
                          title="Copy TOTP"
                          icon={Icon.CopyClipboard}
                          onAction={() => handleCopyTotp(item.id)}
                        />
                        <Action
                          title="Sync Vault"
                          icon={Icon.ArrowClockwise}
                          onAction={handleSync}
                        />
                      </ActionPanel>
                    }
                  />
                );
              })}
            </List.Section>
          ))
        )
      ) : (
        <List.EmptyView title="Loading..." />
      )}
    </List>
  );
}
