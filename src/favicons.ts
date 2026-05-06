import { LocalStorage, environment } from '@vicinae/api';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FAVICON_CACHE_KEY = 'vicinae-bitwarden-favicons';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export type FaviconMap = Record<string, string>;

interface CacheEntry {
  dataUri: string;
  timestamp: number;
}

let faviconCache: Record<string, CacheEntry> = {};

export async function loadFaviconCache(): Promise<FaviconMap> {
  try {
    const raw = await LocalStorage.getItem<string>(FAVICON_CACHE_KEY);
    if (!raw) return {};
    const parsed: Record<string, unknown> = JSON.parse(raw);
    const result: FaviconMap = {};
    for (const [domain, value] of Object.entries(parsed)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'dataUri' in value &&
        'timestamp' in value
      ) {
        const entry = value as CacheEntry;
        // Legacy: entries stored as file paths need converting to data URIs
        if (entry.dataUri.startsWith('/')) {
          try {
            entry.dataUri = fileToDataUri(entry.dataUri);
          } catch {
            entry.dataUri = '';
            entry.timestamp = 0;
          }
        }
        result[domain] = entry.dataUri;
        if (!faviconCache[domain]) faviconCache[domain] = entry;
      } else if (typeof value === 'string') {
        // Old plain-string format — treat as stale so it gets replaced
        result[domain] = value;
        if (!faviconCache[domain]) faviconCache[domain] = { dataUri: value, timestamp: 0 };
      }
    }
    return result;
  } catch {
    return {};
  }
}

async function persistFaviconCache(): Promise<void> {
  const map: Record<string, CacheEntry> = {};
  for (const [domain, entry] of Object.entries(faviconCache)) {
    if (entry.dataUri) map[domain] = entry;
  }
  await LocalStorage.setItem(FAVICON_CACHE_KEY, JSON.stringify(map));
}

// Pre-warm the in-memory cache on module init
void loadFaviconCache();

export function extractHostname(uris?: { uri: string }[]): string | null {
  if (!uris?.length) return null;
  for (const u of uris) {
    if (!u.uri) continue;
    try {
      return new URL(/^https?:\/\//.test(u.uri) ? u.uri : `https://${u.uri}`).hostname;
    } catch {
      continue;
    }
  }
  return null;
}

function faviconDir(): string {
  return join(environment.supportPath, 'favicons');
}

function ensureFaviconDir(): void {
  const dir = faviconDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Google's globe placeholder — same 16x16 PNG regardless of sz param
const GLOBE_MD5 = 'b8a0bf372c762e966cc99ede8682bc71';

function isGlobeFavicon(buf: Buffer, status: number): boolean {
  if (status === 404) return true;
  if (buf.length < 24) return false;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return false;
  const width = buf.readUInt32BE(16);
  if (width <= 16) return true;
  const hash = createHash('md5').update(buf).digest('hex');
  return hash === GLOBE_MD5;
}

function fileToDataUri(filePath: string): string {
  const buf = readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function resolveDomain(domain: string, now: number, result: FaviconMap): boolean {
  const entry = faviconCache[domain];
  const filePath = join(faviconDir(), `${encodeURIComponent(domain)}.png`);

  // In-memory cache hit
  if (entry && entry.dataUri && now - entry.timestamp <= CACHE_TTL) {
    if (existsSync(filePath)) {
      result[domain] = entry.dataUri;
      return true;
    }
    // File deleted since last cache — fall through to re-download
  }

  // Cold hit: file exists on disk from previous session
  if (existsSync(filePath)) {
    try {
      const mtime = statSync(filePath).mtimeMs;
      if (now - mtime <= CACHE_TTL) {
        const dataUri = fileToDataUri(filePath);
        result[domain] = dataUri;
        faviconCache[domain] = { dataUri, timestamp: mtime };
        return true;
      }
    } catch {
      // stale or unreadable — re-download
    }
  }

  return false;
}

/**
 * Fetch a fresh favicon from Google, write it to disk, and cache as a data URI.
 * Returns a data URI on success, empty string on failure.
 */
async function fetchAndWrite(domain: string, filePath: string, now: number): Promise<string> {
  const url = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      faviconCache[domain] = { dataUri: '', timestamp: now };
      return '';
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (isGlobeFavicon(buf, res.status)) {
      faviconCache[domain] = { dataUri: '', timestamp: now };
      return '';
    }
    writeFileSync(filePath, buf);
    const mime = res.headers.get('content-type') ?? 'image/png';
    const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
    faviconCache[domain] = { dataUri, timestamp: now };
    return dataUri;
  } catch {
    faviconCache[domain] = { dataUri: '', timestamp: now };
    return '';
  }
}

// Cap concurrent network fetches: Google's favicon service times out under
// burst load (we hit ~5% timeouts at ~50 parallel requests, more above that).
const MAX_CONCURRENT_FETCHES = 8;

export async function resolveFavicons(domains: string[]): Promise<FaviconMap> {
  const now = Date.now();
  ensureFaviconDir();
  const result: FaviconMap = {};
  const unique = [...new Set(domains)];

  // First pass: resolve everything we can from cache/disk synchronously.
  const toFetch: string[] = [];
  for (const domain of unique) {
    if (!resolveDomain(domain, now, result)) toFetch.push(domain);
  }

  // Second pass: fetch the rest with bounded concurrency.
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_FETCHES, toFetch.length) },
    async () => {
      while (cursor < toFetch.length) {
        const domain = toFetch[cursor++];
        const filePath = join(faviconDir(), `${encodeURIComponent(domain)}.png`);
        const dataUri = await fetchAndWrite(domain, filePath, now);
        if (dataUri) result[domain] = dataUri;
      }
    },
  );
  await Promise.all(workers);

  await persistFaviconCache();
  return result;
}

export function clearFaviconCache(): void {
  faviconCache = {};
}
