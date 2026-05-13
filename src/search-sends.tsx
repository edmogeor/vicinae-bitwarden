// fallow-ignore-file unused-file
import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  confirmAlert,
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
import {
  buildDeletionCountdown,
  buildExpirationCountdown,
  filterSends,
  getSendActions,
  sendAccessUrl,
  sendActionIcon,
  sendIcon,
  sendSubtitle,
  sendTypeLabel,
} from './send-utils';
import { useSession } from './use-session';
import { loadCachedSends, saveCachedSends } from './vault-cache';
import { castGateSetter, renderGate, useGateEffects } from './unlock-gate';
import type { GateUIState } from './unlock-gate';
import EditSend from './edit-send';

type UIState = GateUIState | { kind: 'loading' } | { kind: 'list' };

export default function SearchSends() {
  const { session, unlock, loginIfNeeded, loginError } = useSession();
  const [state, setState] = useState<UIState>({ kind: 'checking-bw' });
  const [sends, setSends] = useState<BwSend[]>([]);
  const [searchText, setSearchText] = useState('');
  const { push } = useNavigation();

  const { handleLogin, handleUnlock } = useGateEffects({
    session,
    state,
    loginIfNeeded,
    loginError,
    unlock,
    setState: castGateSetter(setState),
    readyKind: 'loading',
  });

  const loadSends = useCallback(async () => {
    if (!session) return;
    try {
      await bw.sync(session);
      const result = await bw.listSends(session);
      setSends(result);
      await saveCachedSends(result);
    } catch (err) {
      const message = getErrorMessage(err);
      await showToast({ style: Toast.Style.Failure, title: 'Failed to load sends', message });
    }
  }, [session]);

  useEffect(() => {
    if (state.kind !== 'loading') return;
    void (async () => {
      const cached = await loadCachedSends();
      if (cached) setSends(cached);
      await loadSends();
      setState({ kind: 'list' });
    })();
  }, [state.kind]);

  const handleSync = useCallback(async () => {
    setState({ kind: 'loading' });
  }, []);

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
          const expirationLabel = buildExpirationCountdown(send);
          const accessories: List.Item.Accessory[] = [{ text: sendTypeLabel(send) }];
          if (daysLabel) accessories.push({ icon: Icon.Clock, text: daysLabel });
          if (expirationLabel) accessories.push({ icon: Icon.Hourglass, text: expirationLabel });

          return (
            <List.Item
              key={send.id}
              icon={sendIcon(send.type)}
              title={send.name}
              subtitle={sendSubtitle(send)}
              accessories={accessories}
              actions={
                <ActionPanel>
                  {renderSendActions(
                    send,
                    session,
                    push,
                    (id) => {
                      setSends((prev) => {
                        const next = prev.filter((s) => s.id !== id);
                        void saveCachedSends(next);
                        return next;
                      });
                    },
                    handleSync,
                  )}
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
  onRemoved: (id: string) => void,
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
          push(
            <SendDetailView send={send} session={session} onDeleted={() => onRemoved(send.id)} />,
          );
        }}
      />
      <Action title="Sync Sends" icon={Icon.ArrowClockwise} onAction={onSync} />
    </>
  );
}

function SendDetailView({
  send,
  session,
  onDeleted,
}: {
  send: BwSend;
  session: bw.Session | null;
  onDeleted: () => void;
}) {
  const { pop, push } = useNavigation();
  const url = sendAccessUrl(send);
  const textContent = send.text?.text ?? '';
  const notesSection = send.notes ? `## Notes\n${send.notes}` : '';
  const separator = textContent && notesSection ? '\n---\n' : '';
  const markdown = [textContent, separator, notesSection].filter(Boolean).join('');

  const handleDelete = async () => {
    if (!session) return;
    const confirmed = await confirmAlert({
      title: 'Delete Send',
      message: `Are you sure you want to delete "${send.name}"?`,
      primaryAction: { title: 'Delete', style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await bw.deleteSend(send.id, session);
      await showToast({ style: Toast.Style.Success, title: 'Send deleted', message: send.name });
      onDeleted();
      pop();
    } catch (err) {
      const message = getErrorMessage(err);
      await showToast({ style: Toast.Style.Failure, title: 'Delete failed', message });
    }
  };

  const sendActions = getSendActions(send);

  return (
    <Detail
      markdown={markdown}
      navigationTitle={send.name}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Type" text={sendTypeLabel(send)} />
          {send.file?.fileName && (
            <Detail.Metadata.Label
              title="File"
              text={`${send.file.fileName} (${send.file.sizeName})`}
            />
          )}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Access Count"
            text={
              send.maxAccessCount
                ? `${send.accessCount} / ${send.maxAccessCount}`
                : String(send.accessCount)
            }
          />
          <Detail.Metadata.Label
            title="Deletion Date"
            text={new Date(send.deletionDate).toLocaleString()}
          />
          {send.password ? <Detail.Metadata.Label title="Password" text="Yes" /> : null}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="URL" text={url} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {sendActions.map((action) => (
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
          {session && (
            <>
              <Action
                title="Edit Send"
                icon={Icon.Pencil}
                onAction={() => {
                  push(<EditSend send={send} session={session} onSaved={() => pop()} />);
                }}
              />
              <Action title="Delete Send" icon={Icon.Trash} onAction={() => void handleDelete()} />
            </>
          )}
        </ActionPanel>
      }
    />
  );
}
