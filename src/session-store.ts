import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getAutoLockSeconds, getPreferences } from './preferences';
import { spawnWait } from './spawn-stdin';

const exec = promisify(execFile);

const SERVICE = 'vicinae-bitwarden';
const ACCOUNT = 'session';

interface SessionPayload {
  token: string;
  timestamp: number;
}

let installed: boolean | null = null;

function isNodeError(err: unknown): err is { code: string } & Error {
  return err instanceof Error && 'code' in err;
}

export async function checkSecretToolInstalled(): Promise<boolean> {
  if (installed !== null) return installed;
  try {
    await exec('secret-tool', ['lookup', 'service', SERVICE, 'account', ACCOUNT], {
      timeout: 3000,
    });
    installed = true;
    return true;
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      installed = false;
      return false;
    }
    installed = true;
    return true;
  }
}

export async function getSession(): Promise<string | null> {
  try {
    const { stdout } = await exec(
      'secret-tool',
      ['lookup', 'service', SERVICE, 'account', ACCOUNT],
      { timeout: 5000 },
    );
    const raw = stdout.trim();
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw;
    }

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'token' in parsed &&
      'timestamp' in parsed &&
      typeof (parsed as Record<string, unknown>).token === 'string' &&
      typeof (parsed as Record<string, unknown>).timestamp === 'number'
    ) {
      const { token, timestamp } = parsed as SessionPayload;
      const timeout = getAutoLockSeconds(getPreferences());
      if (timeout > 0 && Date.now() - timestamp > timeout * 1000) {
        await deleteSession();
        return null;
      }
      return token;
    }

    return null;
  } catch {
    return null;
  }
}

export async function setSession(token: string): Promise<void> {
  const payload: SessionPayload = { token, timestamp: Date.now() };
  await spawnWait(
    'secret-tool',
    ['store', '--label=Vicinae Bitwarden', 'service', SERVICE, 'account', ACCOUNT],
    JSON.stringify(payload),
  );
}

export async function deleteSession(): Promise<void> {
  try {
    await exec('secret-tool', ['clear', 'service', SERVICE, 'account', ACCOUNT], {
      timeout: 5000,
    });
  } catch {
    // Not found or error — not fatal
  }
}
