import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const SERVICE = 'vicinae-bitwarden';
const ACCOUNT = 'session';

let installed: boolean | null = null;

export async function checkInstalled(): Promise<boolean> {
  if (installed !== null) return installed;
  try {
    await exec('secret-tool', ['--version'], { timeout: 3000 });
    installed = true;
  } catch {
    installed = false;
  }
  return installed;
}

function writeStdin(proc: ReturnType<typeof spawn>, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    proc.on('error', reject);
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
    { stdio: ['pipe', 'ignore', 'ignore'], timeout: 5000 },
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
