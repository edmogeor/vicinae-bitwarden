import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const exec = promisify(execFile);

const SERVICE = 'vicinae-bitwarden';
const ACCOUNT = 'api-creds';

function getHome(): string {
  const home = process.env.HOME;
  if (!home) throw new Error('HOME environment variable is not set');
  return home;
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

export async function storeApiCredentials(clientId: string, clientSecret: string): Promise<void> {
  const proc = spawn(
    'secret-tool',
    ['store', '--label=Vicinae Bitwarden API Key', 'service', SERVICE, 'account', ACCOUNT],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );

  const payload = JSON.stringify({ clientId, clientSecret });
  await writeStdin(proc, payload);

  await new Promise<void>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`secret-tool exited with code ${code}`));
    });
  });
}

export async function getApiCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
} | null> {
  try {
    const { stdout } = await exec(
      'secret-tool',
      ['lookup', 'service', SERVICE, 'account', ACCOUNT],
      { timeout: 5000 },
    );
    const raw = stdout.trim();
    if (!raw) return null;
    return JSON.parse(raw) as { clientId: string; clientSecret: string };
  } catch {
    return null;
  }
}

export async function deleteApiCredentials(): Promise<void> {
  try {
    await exec('secret-tool', ['clear', 'service', SERVICE, 'account', ACCOUNT], {
      timeout: 5000,
    });
  } catch {
    // Not found or error — not fatal
  }
}

export async function clearApiCredentialsFromDisk(): Promise<void> {
  try {
    const settingsPath = join(getHome(), '.config', 'vicinae', 'settings.json');
    const content = readFileSync(settingsPath, 'utf-8');
    const updated = content.replace(/"apiClientId"\s*:\s*"[^"]*"/, '"apiClientId": ""');
    if (updated !== content) {
      writeFileSync(settingsPath, updated, 'utf-8');
    }
  } catch (err) {
    console.warn('Failed to clear apiClientId from settings.json:', err);
  }

  try {
    const Database = (await import('better-sqlite3')).default;
    const dbPath = join(getHome(), '.local', 'share', 'vicinae', 'vicinae.db');
    const db = new Database(dbPath);
    db.prepare(
      "DELETE FROM storage_data_item WHERE namespace_id = 'bitwarden:preferences' AND key = 'apiClientSecret'",
    ).run();
    db.close();
  } catch (err) {
    console.warn('Failed to clear apiClientSecret from vicinae.db:', err);
  }
}
