import { Action, ActionPanel, Form, showToast, Toast } from '@vicinae/api';
import { useCallback } from 'react';
import { BwNotInstalled, SecretToolNotInstalled } from './bw-not-installed';
import * as bw from './bw-executor';
import { getErrorMessage } from './bw-executor';
import { checkSecretToolInstalled } from './session-store';

export async function checkBwGate(
  session: string | null,
): Promise<
  | { kind: 'bw-not-installed' }
  | { kind: 'secret-tool-not-installed' }
  | { kind: 'logging-in' }
  | { kind: 'needs-unlock' }
  | { kind: 'ready' }
> {
  const [installed, stInstalled, statusResult] = await Promise.allSettled([
    bw.checkInstalled(),
    checkSecretToolInstalled(),
    bw.status(),
  ]);

  if (installed.status === 'rejected' || !installed.value) {
    return { kind: 'bw-not-installed' };
  }

  if (stInstalled.status === 'rejected' || !stInstalled.value) {
    return { kind: 'secret-tool-not-installed' };
  }

  if (statusResult.status === 'fulfilled' && statusResult.value.status === 'unauthenticated') {
    return { kind: 'logging-in' };
  }

  if (session) return { kind: 'ready' };
  return { kind: 'needs-unlock' };
}

type GateSetState = (
  next:
    | { kind: 'unlocking' }
    | { kind: 'needs-unlock'; error?: string }
    | { kind: 'login-failed'; error: string },
) => void;

export function createUnlockCallbacks(
  setState: GateSetState,
  onUnlockReady: () => void,
): Pick<
  UnlockGateDeps,
  'onUnlockStart' | 'onUnlockReady' | 'onUnlockError' | 'onLoginReady' | 'onLoginError'
> {
  return {
    onUnlockStart: () => setState({ kind: 'unlocking' }),
    onUnlockReady,
    onUnlockError: (error) => setState({ kind: 'needs-unlock', error }),
    onLoginReady: () => setState({ kind: 'needs-unlock' }),
    onLoginError: (error) => setState({ kind: 'login-failed', error }),
  };
}

interface UnlockGateDeps {
  loginIfNeeded: () => Promise<void>;
  loginError: string | null;
  unlock: (password: string) => Promise<string>;
  onUnlockStart: () => void;
  onUnlockReady: () => void;
  onUnlockError: (error: string) => void;
  onLoginReady: () => void;
  onLoginError: (error: string) => void;
}

export function useUnlockGate(deps: UnlockGateDeps) {
  const handleLogin = useCallback(async () => {
    try {
      await deps.loginIfNeeded();
      deps.onLoginReady();
    } catch {
      const message = deps.loginError ?? 'Login failed — check preferences';
      deps.onLoginError(message);
      showToast({
        style: Toast.Style.Failure,
        title: 'Login failed',
        message: deps.loginError ?? 'Check your API key in preferences',
      });
    }
  }, [deps.loginIfNeeded, deps.loginError, deps.onLoginReady, deps.onLoginError]);

  const handleUnlock = useCallback(
    async (values: Form.Values) => {
      deps.onUnlockStart();
      try {
        const password = String(values.password ?? '');
        await deps.unlock(password);
        deps.onUnlockReady();
      } catch (err) {
        const message = getErrorMessage(err);
        deps.onUnlockError(message);
      }
    },
    [deps.unlock, deps.onUnlockStart, deps.onUnlockReady, deps.onUnlockError],
  );

  return { handleLogin, handleUnlock };
}

interface GateState {
  kind: string;
  error?: string;
}

export function renderGate(
  state: GateState,
  handleUnlock: (values: Form.Values) => Promise<void>,
  handleLogin?: () => void,
): React.ReactElement | null {
  const gateError =
    state.kind === 'needs-unlock' || state.kind === 'login-failed' ? state.error : undefined;
  return renderUnlockGate(state.kind, gateError, handleUnlock, handleLogin);
}

export function renderUnlockGate(
  kind: string,
  error: string | undefined,
  onUnlock: (values: Form.Values) => Promise<void>,
  onRetryLogin?: () => void,
) {
  if (kind === 'bw-not-installed') return <BwNotInstalled />;

  if (kind === 'secret-tool-not-installed') return <SecretToolNotInstalled />;

  if (kind === 'login-failed') {
    return (
      <Form
        actions={
          <ActionPanel>
            {onRetryLogin && <Action title="Retry Login" onAction={onRetryLogin} />}
          </ActionPanel>
        }
      >
        <Form.Description
          title="Login failed"
          text={error ?? 'Check your API key in extension preferences'}
        />
      </Form>
    );
  }

  if (kind === 'needs-unlock' || kind === 'unlocking') {
    return (
      <Form
        isLoading={kind === 'unlocking'}
        actions={
          <ActionPanel>
            <Action.SubmitForm title="Unlock" onSubmit={onUnlock} />
          </ActionPanel>
        }
      >
        <Form.PasswordField
          id="password"
          title="Master Password"
          error={kind === 'needs-unlock' ? error : undefined}
        />
      </Form>
    );
  }

  return null;
}
