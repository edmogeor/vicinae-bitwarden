import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { getAutoLockSeconds, getPreferences } from './preferences';

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
  if (installed) return true;
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
    // Key not found, permission denied, etc. — tool is installed
    installed = true;
    return true;
  }
}

function writeStdin(proc: ReturnType<typeof spawn>, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!proc.stdin) {
      reject(new Error('secret-tool stdin is not available'));
      return;
    }
    proc.on('error', reject);
    proc.stdin.on('error', reject);
    proc.stdin.write(data);
    proc.stdin.end();
    proc.stdin.on('finish', resolve);
  });
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

    // Backward compat: old format is a raw token string (no JSON wrapper)
    try {
      const parsed: SessionPayload = JSON.parse(raw);
      const timeout = getAutoLockSeconds(getPreferences());
      if (timeout > 0 && Date.now() - parsed.timestamp > timeout * 1000) {
        await deleteSession(); // Expired — clear it
        return null;
      }
      return parsed.token;
    } catch {
      // Old format: raw token string — treat as valid
      return raw;
    }
  } catch {
    return null;
  }
}

export async function setSession(token: string): Promise<void> {
  const payload: SessionPayload = { token, timestamp: Date.now() };
  const proc = spawn(
    'secret-tool',
    ['store', '--label=Vicinae Bitwarden', 'service', SERVICE, 'account', ACCOUNT],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );

  await writeStdin(proc, JSON.stringify(payload));

  await new Promise<void>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`secret-tool exited with code ${code}`));
    });
  });
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
