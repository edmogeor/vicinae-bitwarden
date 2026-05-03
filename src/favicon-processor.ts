import { environment } from "@vicinae/api";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Jimp } from "jimp";

const SIZE = 64;
const RADIUS = 14;
const CACHE_DIR = join(environment.supportPath, "favicons");
const BG_LIGHT = 0xe8e8e8ff;
const BG_DARK = 0x2d2d2dff;

function bgColor(): number {
  return environment.theme === "dark" ? BG_DARK : BG_LIGHT;
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cachePath(domain: string): string {
  return join(CACHE_DIR, `${domain}.png`);
}

/**
 * Create a rounded-rectangle mask using Jimp's circle plugin.
 * The mask is a white rectangle with black circles punched out at each corner.
 */
async function roundedMask() {
  // White mask
  const mask = new Jimp({ width: SIZE, height: SIZE, color: 0xffffffff });

  // Black circle for corners
  const corner = new Jimp({ width: RADIUS, height: RADIUS, color: 0x000000ff });
  corner.circle();

  mask.blit({ src: corner, x: 0, y: 0 });
  mask.blit({ src: corner, x: SIZE - RADIUS, y: 0 });
  mask.blit({ src: corner, x: 0, y: SIZE - RADIUS });
  mask.blit({ src: corner, x: SIZE - RADIUS, y: SIZE - RADIUS });

  return mask;
}

/**
 * Fetch and process a favicon for a domain.
 * Returns the local file path to the processed PNG, or null on failure.
 */
export async function processFavicon(domain: string): Promise<string | null> {
  const outPath = cachePath(domain);

  if (existsSync(outPath)) return outPath;

  ensureCacheDir();

  try {
    const res = await fetch(
      `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
    );

    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const favicon = await Jimp.read(buffer);
    favicon.cover({ w: SIZE, h: SIZE });

    // Create colored background
    const bg = new Jimp({ width: SIZE, height: SIZE, color: bgColor() });

    // Composite favicon onto background at full size
    bg.blit({ src: favicon, x: 0, y: 0 });

    // Apply rounded-rectangle mask
    const mask = await roundedMask();
    bg.mask({ src: mask } as any);

    await bg.write(outPath as any);
    return outPath;
  } catch {
    return null;
  }
}

/**
 * Process favicons for an array of domains.
 * Returns a domain → filepath map for successfully processed icons.
 */
export async function processFavicons(
  domains: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(domains)];
  const map: Record<string, string> = {};

  const CONCURRENCY = 4;
  const queue = [...unique];

  async function worker() {
    while (queue.length > 0) {
      const domain = queue.shift()!;
      const path = await processFavicon(domain);
      if (path) map[domain] = path;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
  );

  return map;
}
