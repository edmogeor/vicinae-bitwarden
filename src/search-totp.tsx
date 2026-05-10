// fallow-ignore-file unused-file (entry point registered in package.json commands)
import { Action, ActionPanel, Clipboard, Icon, List, showToast, Toast } from '@vicinae/api';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as bw from './bw-executor';
import { getErrorMessage } from './bw-executor';
import { filterItems, formatTotp, groupByFolder, itemIcon, itemSubtitle } from './item-utils';
import { useSession } from './use-session';
import { createUnlockCallbacks, renderGate, useUnlockGate } from './unlock-gate';
import { useVaultSync } from './use-vault-sync';
import { useVaultLifecycle, type UIState } from './vault-lifecycle';
import type { BwFolder, BwItem } from './bitwarden-types';
import { ItemType } from './bitwarden-types';

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

  useVaultLifecycle({
    session,
    state,
    setState,
    setVault,
    syncVault,
    handleLogin,
    clearSession,
    setFaviconMap,
  });

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

  function renderVaultContent() {
    if (sortedSections.length === 0) {
      return (
        <List.EmptyView
          title={searchText ? 'No matching items' : 'No TOTP accounts'}
          description={
            searchText
              ? 'Try a different search or Sync to refresh'
              : 'No accounts with TOTP set up in your vault'
          }
        />
      );
    }

    return sortedSections.map(([folderId, { folderName, items: sectionItems }]) => (
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
                  <Action title="Sync Vault" icon={Icon.ArrowClockwise} onAction={handleSync} />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    ));
  }

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={state.kind === 'vault' ? setSearchText : undefined}
      searchBarPlaceholder="Search accounts with TOTP..."
      throttle
    >
      {state.kind === 'vault' ? renderVaultContent() : <List.EmptyView title="Loading..." />}
    </List>
  );
}
