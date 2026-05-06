import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const SERVICE = 'vicinae-bitwarden';
const ACCOUNT = 'session';

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
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

export async function setSession(token: string): Promise<void> {
  const proc = spawn(
    'secret-tool',
    ['store', '--label=Vicinae Bitwarden', 'service', SERVICE, 'account', ACCOUNT],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );

  await writeStdin(proc, token);

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
