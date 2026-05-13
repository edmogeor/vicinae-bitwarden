import { getAutoLockSeconds, getPreferences } from './preferences';
import { secretStore, secretLookup, secretClear } from './secret-store';

export { checkSecretToolInstalled } from './secret-store';

const ACCOUNT = 'session';

interface SessionPayload {
  token: string;
  timestamp: number;
}

export async function getSession(): Promise<string | null> {
  try {
    const raw = await secretLookup(ACCOUNT);
    if (!raw) return null;

    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }

    if (typeof obj !== 'object' || obj === null || !('token' in obj) || !('timestamp' in obj)) {
      return null;
    }
    const record = obj as Record<string, unknown>;
    if (typeof record.token !== 'string' || typeof record.timestamp !== 'number') {
      return null;
    }

    const token = record.token;
    const timestamp = record.timestamp;
    const timeout = getAutoLockSeconds(getPreferences());
    if (timeout > 0 && Date.now() - timestamp > timeout * 1000) {
      await deleteSession();
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export async function setSession(token: string): Promise<void> {
  const payload: SessionPayload = { token, timestamp: Date.now() };
  await secretStore(ACCOUNT, JSON.stringify(payload), 'Vicinae Bitwarden');
}

export async function deleteSession(): Promise<void> {
  await secretClear(ACCOUNT);
}
