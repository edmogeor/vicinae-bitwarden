import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Icon,
  popToRoot,
  showToast,
  Toast,
} from '@vicinae/api';
import { useCallback, useEffect, useState } from 'react';
import * as bw from './bw-executor';
import { getErrorMessage } from './bw-executor';
import { SendType } from './send-types';
import type { SendTypeValue } from './send-types';
import { sendAccessUrl, toSendPayload } from './send-utils';
import { useSession } from './use-session';
import { checkBwGate, createUnlockCallbacks, renderGate, useUnlockGate } from './unlock-gate';

type UIState =
  | { kind: 'checking-bw' }
  | { kind: 'bw-not-installed' }
  | { kind: 'secret-tool-not-installed' }
  | { kind: 'logging-in' }
  | { kind: 'login-failed'; error: string }
  | { kind: 'needs-unlock'; error?: string }
  | { kind: 'unlocking' }
  | { kind: 'form' };

const SEND_TYPE_MAP: Record<string, SendTypeValue> = {
  Text: SendType.Text,
  File: SendType.File,
};

const SEND_TYPE_OPTIONS = Object.keys(SEND_TYPE_MAP).map((label) => ({
  value: label,
  label,
}));

function readFormValues(values: Form.Values): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(values)) {
    result[key] = String(val ?? '');
  }
  return result;
}

export default function CreateSend() {
  const { session, unlock, loginIfNeeded, loginError } = useSession();
  const [state, setState] = useState<UIState>({ kind: 'checking-bw' });
  const [selectedType, setSelectedType] = useState<string>('Text');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { handleLogin, handleUnlock } = useUnlockGate({
    loginIfNeeded,
    loginError,
    unlock,
    ...createUnlockCallbacks(setState, () => setState({ kind: 'form' })),
  });

  useEffect(() => {
    void (async () => {
      const gate = await checkBwGate(session);
      switch (gate.kind) {
        case 'bw-not-installed':
        case 'secret-tool-not-installed':
        case 'logging-in':
        case 'needs-unlock':
          setState({ kind: gate.kind });
          return;
        case 'ready':
          setState({ kind: 'form' });
          return;
      }
    })();
  }, []);

  useEffect(() => {
    if (!session) return;
    if (state.kind !== 'needs-unlock') return;
    setState({ kind: 'form' });
  }, [session, state.kind]);

  useEffect(() => {
    if (state.kind !== 'logging-in') return;
    void handleLogin();
  }, [state.kind]);

  const handleSubmit = useCallback(
    async (values: Form.Values) => {
      if (!session) return;

      const sendValues = readFormValues(values);
      const typeNum = SEND_TYPE_MAP[selectedType] ?? SendType.Text;

      setIsSubmitting(true);
      try {
        const payload = toSendPayload(sendValues, typeNum);
        const created = await bw.createSend(payload, session);
        const url = sendAccessUrl(created);
        await Clipboard.copy(url);
        await showToast({
          style: Toast.Style.Success,
          title: 'Send created',
          message: 'Link copied to clipboard',
        });
        await popToRoot();
      } catch (err) {
        const message = getErrorMessage(err);
        await showToast({
          style: Toast.Style.Failure,
          title: 'Failed to create send',
          message,
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [session, selectedType],
  );

  const gateRender = renderGate(state, handleUnlock, handleLogin);
  if (gateRender) return gateRender;

  if (state.kind === 'checking-bw' || state.kind === 'logging-in') {
    return (
      <Form>
        <Form.Description text="Loading..." />
      </Form>
    );
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Send" icon={Icon.Plus} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="sendType"
        title="Type"
        value={selectedType}
        onChange={(value) => setSelectedType(String(value ?? 'Text'))}
      >
        {SEND_TYPE_OPTIONS.map((opt) => (
          <Form.Dropdown.Item key={opt.value} value={opt.value} title={opt.label} />
        ))}
      </Form.Dropdown>

      <Form.Separator />

      <Form.TextField id="name" title="Name" />

      {selectedType === 'Text' && (
        <>
          <Form.TextArea id="textContent" title="Text Content" />
          <Form.Checkbox id="hideText" title="Hide Text" label="Require access to view text" />
        </>
      )}

      {selectedType === 'File' && <Form.TextField id="fileName" title="File Name" />}

      <Form.Separator />

      <Form.PasswordField id="password" title="Password (optional)" />

      <Form.TextField id="deletionDays" title="Deletion Days" defaultValue="7" />

      <Form.TextField id="maxAccessCount" title="Max Access Count (optional)" />

      <Form.Separator />

      <Form.TextArea id="notes" title="Notes (optional)" />
    </Form>
  );
}
