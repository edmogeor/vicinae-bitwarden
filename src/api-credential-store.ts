import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { spawnWait } from './spawn-stdin';

const exec = promisify(execFile);

const SERVICE = 'vicinae-bitwarden';
const ACCOUNT = 'api-creds';

function getHome(): string {
  const home = process.env.HOME;
  if (!home) throw new Error('HOME environment variable is not set');
  return home;
}

export async function storeApiCredentials(clientId: string, clientSecret: string): Promise<void> {
  const payload = JSON.stringify({ clientId, clientSecret });
  await spawnWait(
    'secret-tool',
    ['store', '--label=Vicinae Bitwarden API Key', 'service', SERVICE, 'account', ACCOUNT],
    payload,
  );
}

function parseJsonRecord(raw: string): { clientId: string; clientSecret: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'clientId' in parsed &&
    'clientSecret' in parsed &&
    typeof (parsed as Record<string, unknown>).clientId === 'string' &&
    typeof (parsed as Record<string, unknown>).clientSecret === 'string'
  ) {
    return {
      clientId: (parsed as Record<string, string>).clientId,
      clientSecret: (parsed as Record<string, string>).clientSecret,
    };
  }
  return null;
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
    return parseJsonRecord(raw);
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
