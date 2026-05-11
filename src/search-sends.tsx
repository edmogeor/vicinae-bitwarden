// fallow-ignore-file unused-file
import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from '@vicinae/api';
import { useCallback, useEffect, useState } from 'react';
import * as bw from './bw-executor';
import { getErrorMessage } from './bw-executor';
import type { BwSend } from './send-types';
import { SendType } from './send-types';
import {
  buildDeletionCountdown,
  filterSends,
  sendAccessUrl,
  sendActions as getSendActions,
  sendActionIcon,
  sendSubtitle,
  sendTypeLabel,
} from './send-utils';
import { useSession } from './use-session';
import { renderGate, useGateEffects } from './unlock-gate';
import type { GateUIState } from './unlock-gate';

type UIState = GateUIState | { kind: 'loading' } | { kind: 'list' };

export default function SearchSends() {
  const { session, unlock, loginIfNeeded, loginError } = useSession();
  const [state, setState] = useState<UIState>({ kind: 'checking-bw' });
  const [sends, setSends] = useState<BwSend[]>([]);
  const [searchText, setSearchText] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const { push } = useNavigation();

  const { handleLogin, handleUnlock } = useGateEffects({
    session,
    state,
    loginIfNeeded,
    loginError,
    unlock,
    setState: (next) => setState(next as UIState),
    readyKind: 'loading',
  });

  const loadSends = useCallback(async () => {
    if (!session) return;
    try {
      const result = await bw.listSends(session);
      setSends(result);
    } catch (err) {
      const message = getErrorMessage(err);
      await showToast({ style: Toast.Style.Failure, title: 'Failed to load sends', message });
    }
  }, [session]);

  useEffect(() => {
    if (state.kind !== 'loading') return;
    void (async () => {
      await loadSends();
      setState({ kind: 'list' });
    })();
  }, [state.kind]);

  const handleSync = useCallback(async () => {
    setState({ kind: 'loading' });
  }, []);

  const handleDelete = useCallback(
    async (sendId: string) => {
      if (!session) return;
      setDeleting(sendId);
      try {
        await bw.deleteSend(sendId, session);
        setSends((prev) => prev.filter((s) => s.id !== sendId));
        await showToast({ style: Toast.Style.Success, title: 'Send deleted' });
      } catch (err) {
        const message = getErrorMessage(err);
        await showToast({ style: Toast.Style.Failure, title: 'Failed to delete send', message });
      } finally {
        setDeleting(null);
      }
    },
    [session],
  );

  const gateRender = renderGate(state, handleUnlock, handleLogin);
  if (gateRender) return gateRender;

  if (state.kind === 'checking-bw' || state.kind === 'logging-in' || state.kind === 'loading') {
    return (
      <List isLoading>
        <List.EmptyView title="Loading..." />
      </List>
    );
  }

  const filtered = filterSends(sends, searchText);

  return (
    <List
      isLoading={deleting !== null}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search sends by name..."
      throttle
    >
      {filtered.length === 0 ? (
        <List.EmptyView
          title={searchText ? 'No matching sends' : 'No Sends'}
          description={
            searchText
              ? 'Try a different search or Sync to refresh'
              : 'Create a Send to share text or files securely'
          }
          actions={
            <ActionPanel>
              <Action title="Sync Sends" icon={Icon.ArrowClockwise} onAction={handleSync} />
            </ActionPanel>
          }
        />
      ) : (
        filtered.map((send) => {
          const daysLabel = buildDeletionCountdown(send);
          const accessories: List.Item.Accessory[] = [{ text: sendTypeLabel(send) }];
          if (daysLabel) accessories.push({ text: daysLabel });

          return (
            <List.Item
              key={send.id}
              icon={send.type === SendType.File ? Icon.BlankDocument : Icon.Text}
              title={send.name}
              subtitle={sendSubtitle(send)}
              accessories={accessories}
              actions={
                <ActionPanel>
                  {renderSendActions(send, session, push, handleDelete, handleSync)}
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}

function renderSendActions(
  send: BwSend,
  session: bw.Session | null,
  push: ReturnType<typeof useNavigation>['push'],
  onDelete: (id: string) => Promise<void>,
  onSync: () => Promise<void>,
) {
  const actions = getSendActions(send);

  return (
    <>
      {actions.map((action) => (
        <Action
          key={action.label}
          title={action.label}
          icon={sendActionIcon(action)}
          onAction={async () => {
            await Clipboard.copy(action.value);
            await showToast({
              style: Toast.Style.Success,
              title: 'Copied',
              message: action.label,
            });
          }}
        />
      ))}
      <Action
        title="View Details"
        icon={Icon.Eye}
        onAction={() => {
          push(<SendDetailView send={send} />);
        }}
      />
      {session && (
        <Action title="Delete Send" icon={Icon.Trash} onAction={() => void onDelete(send.id)} />
      )}
      <Action title="Sync Sends" icon={Icon.ArrowClockwise} onAction={onSync} />
    </>
  );
}

function SendDetailView({ send }: { send: BwSend }) {
  const url = sendAccessUrl(send);
  const markdown = [
    `# ${send.name}`,
    '',
    `**Type:** ${sendTypeLabel(send)}`,
    send.text?.text
      ? `**Text:** ${send.text.text.slice(0, 200)}${send.text.text.length > 200 ? '…' : ''}`
      : '',
    send.file?.fileName ? `**File:** ${send.file.fileName} (${send.file.sizeName})` : '',
    `**Access Count:** ${send.accessCount}${send.maxAccessCount ? ` / ${send.maxAccessCount}` : ''}`,
    `**Deletion Date:** ${new Date(send.deletionDate).toLocaleString()}`,
    send.password ? '**Password:** Yes' : '',
    send.notes ? `\n**Notes:**\n${send.notes}` : '',
    '',
    `**URL:** ${url}`,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <Detail
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="Copy Send Link"
            icon={Icon.Link}
            onAction={async () => {
              await Clipboard.copy(url);
              await showToast({ style: Toast.Style.Success, title: 'Link copied' });
            }}
          />
        </ActionPanel>
      }
    />
  );
}
