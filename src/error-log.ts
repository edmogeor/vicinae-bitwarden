import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function logPath(): string {
  const dir = join(homedir(), '.vicinae', 'extensions', 'bitwarden');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // Non-fatal
  }
  return join(dir, 'errors.log');
}

export function logError(err: unknown): void {
  try {
    const raw = extractRawError(err);
    const line = `${new Date().toISOString()} ${raw}\n`;
    appendFileSync(logPath(), line, 'utf8');
  } catch {
    // Non-fatal
  }
}

function extractRawError(err: unknown): string {
  if (err instanceof Error) {
    const stderrRaw = (err as unknown as { stderr?: unknown }).stderr;
    const stderr = typeof stderrRaw === 'string' ? stderrRaw.trim() : '';
    return stderr || err.message || String(err);
  }
  return String(err);
}
