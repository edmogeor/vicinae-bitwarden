import {
  Action,
  ActionPanel,
  Clipboard,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from '@vicinae/api';
import { useCallback, useMemo, useState } from 'react';
import * as bw from './bw-executor';
import { getErrorMessage } from './bw-executor';
import {
  filterItems,
  itemActions as getItemActions,
  groupByFolder,
  itemIcon,
  itemSubtitle,
  itemTypeLabel,
} from './item-utils';
import { useSession } from './use-session';
import { createUnlockCallbacks, renderGate, useUnlockGate } from './unlock-gate';
import { useVaultSync } from './use-vault-sync';
import { useVaultLifecycle, type UIState } from './vault-lifecycle';
import ItemDetailView, { renderItemActionElements } from './item-detail-view';
import EditItem from './edit-item';
import type { BwFolder, BwItem } from './bitwarden-types';
import { ItemType } from './bitwarden-types';

export default function SearchVault() {
  const { session, unlock, clearSession, loginIfNeeded, loginError } = useSession();
  const [state, setState] = useState<UIState>({ kind: 'checking-bw' });

  const setVault = (items: BwItem[], folders: BwFolder[]) => {
    setState({ kind: 'vault', items, folders });
  };

  const [searchText, setSearchText] = useState('');
  const [faviconMap, setFaviconMap] = useState<Record<string, string>>({});
  const { push } = useNavigation();

  const { handleLogin, handleUnlock } = useUnlockGate({
    loginIfNeeded,
    loginError,
    unlock,
    ...createUnlockCallbacks(setState, () => setState({ kind: 'loading' })),
  });

  const { syncVault, handleSync, isSyncing } = useVaultSync(session, setVault);

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

  // --- Derived data (must be unconditional — hooks rules) ---
  const vaultItems = state.kind === 'vault' ? state.items : [];
  const vaultFolders = state.kind === 'vault' ? state.folders : [];

  const filtered = useMemo(() => filterItems(vaultItems, searchText), [vaultItems, searchText]);
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

  // --- Render based on state ---

  const gateRender = renderGate(state, handleUnlock, handleLogin);
  if (gateRender) return gateRender;

  // All vault states share a single persistent List to keep handler IDs stable
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
          title={searchText ? 'No matching items' : 'No items in vault'}
          description={
            searchText
              ? 'Try a different search or Sync to refresh your vault'
              : 'Sync to pull your vault data, or create an item'
          }
        />
      );
    }

    return sortedSections.map(([folderId, { folderName, items: sectionItems }]) => (
      <List.Section key={folderId ?? 'unfiled'} title={folderName}>
        {sectionItems.map((item) => (
          <List.Item
            key={item.id}
            icon={itemIcon(item, faviconMap)}
            title={item.name}
            subtitle={itemSubtitle(item)}
            accessories={[{ text: itemTypeLabel(item) }]}
            actions={
              <ActionPanel>
                {renderItemActions(item, session, handleCopyTotp, push, vaultFolders, handleSync)}
                <Action title="Sync Vault" icon={Icon.ArrowClockwise} onAction={handleSync} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    ));
  }

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={state.kind === 'vault' ? setSearchText : undefined}
      searchBarPlaceholder="Search vault by name..."
      throttle
    >
      {state.kind === 'vault' ? renderVaultContent() : <List.EmptyView title="Loading..." />}
    </List>
  );
}

function renderItemActions(
  item: BwItem,
  session: bw.Session | null,
  onCopyTotp: (id: string) => Promise<void>,
  push: ReturnType<typeof useNavigation>['push'],
  folders: BwFolder[],
  onSync: () => Promise<void>,
) {
  const actions = getItemActions(item);
  const folderName = item.folderId
    ? (folders.find((f) => f.id === item.folderId)?.name ?? item.folderId)
    : undefined;

  return (
    <>
      <Action
        title="View Details"
        icon={Icon.Eye}
        onAction={() => {
          push(
            <ItemDetailView
              item={item}
              session={session}
              onCopyTotp={onCopyTotp}
              folderName={folderName}
            />,
          );
        }}
      />
      {renderItemActionElements(actions, onCopyTotp, item.id, session)}
      {session && (
        <Action
          title="Edit Item"
          icon={Icon.Pencil}
          onAction={() => {
            push(<EditItem item={item} session={session} onSaved={() => void onSync()} />);
          }}
        />
      )}
    </>
  );
}
