import { Icon, LocalStorage } from '@vicinae/api';
import type { Image } from '@vicinae/api';
import { BwItem, BwFolder, ItemType } from './bitwarden-types';
import type { BwField, ItemTypeValue } from './bitwarden-types';
import type { CreateItemPayload, ItemAction } from './bw-executor';
import { extractHostname } from './favicons';
import type { FaviconMap } from './favicons';

export const CARD_BRANDS = ['Visa', 'Mastercard', 'Amex', 'Discover', 'Other'];

const CACHE_KEY = 'vicinae-bitwarden-cache';

interface CachedVault {
  items: BwItem[];
  folders: BwFolder[];
  timestamp: number;
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/** Load cached vault data from LocalStorage. Returns null if not found or stale. */
export async function loadCachedVault(): Promise<{ items: BwItem[]; folders: BwFolder[] } | null> {
  try {
    const raw = await LocalStorage.getItem<string>(CACHE_KEY);
    if (!raw) return null;
    const cached: CachedVault = JSON.parse(raw);
    if (Date.now() - cached.timestamp > CACHE_TTL) return null;
    return { items: cached.items, folders: cached.folders };
  } catch {
    return null;
  }
}

/**
 * Strip sensitive fields from an Item before caching.
 * Preserves only the fields needed for list display: name, type, id,
 * folder association, favicon URIs, username, card brand/holder, and identity name.
 * Passwords, card numbers, TOTP seeds, notes, custom fields, etc. are removed.
 */
function stripSensitiveFields(item: BwItem): BwItem {
  const stripped: BwItem = {
    id: item.id,
    organizationId: null,
    folderId: item.folderId,
    type: item.type,
    name: item.name,
    notes: null,
    favorite: item.favorite,
    revisionDate: '',
    creationDate: '',
    deletedDate: null,
    collectionIds: null,
  };

  if (item.login) {
    stripped.login = {
      username: item.login.username,
      password: item.login.password ? '' : null,
      totp: item.login.totp ? '' : null,
      uris: item.login.uris,
      passwordRevisionDate: null,
    };
  }

  if (item.card) {
    stripped.card = {
      cardholderName: item.card.cardholderName,
      brand: item.card.brand,
      number: item.card.number ? '' : null,
      expMonth: null,
      expYear: null,
      code: item.card.code ? '' : null,
    };
  }

  if (item.identity) {
    stripped.identity = {
      title: null,
      firstName: item.identity.firstName,
      middleName: null,
      lastName: item.identity.lastName,
      address1: null,
      address2: null,
      address3: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
      company: null,
      email: null,
      phone: null,
      ssn: null,
      username: null,
      passportNumber: null,
      licenseNumber: null,
    };
  }

  if (item.secureNote) {
    stripped.secureNote = { type: item.secureNote.type };
  }

  stripped.fields = [];

  return stripped;
}

/** Save vault data to LocalStorage for instant load next time. Sensitive fields are stripped. */
export async function saveCachedVault(items: BwItem[], folders: BwFolder[]): Promise<void> {
  const cache: CachedVault = {
    items: items.map(stripSensitiveFields),
    folders,
    timestamp: Date.now(),
  };
  await LocalStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export async function clearCachedVault(): Promise<void> {
  await LocalStorage.removeItem(CACHE_KEY);
}

/**
 * Filter items by a case-insensitive substring match against the item name.
 */
export function filterItems(items: BwItem[], query: string): BwItem[] {
  if (!query.trim()) return items;
  const lower = query.toLowerCase();
  return items.filter((item) => item.name.toLowerCase().includes(lower));
}

type GroupedItems = Map<string | null, { folderName: string; items: BwItem[] }>;

/**
 * Group items by folderId. Returns a Map where:
 * - `null` key maps to unfiled items
 * - Folder ID keys map to items in that folder
 */
export function groupByFolder(
  items: BwItem[],
  folders: { id: string; name: string }[],
): GroupedItems {
  const folderMap = new Map<string, string>();
  for (const f of folders) {
    folderMap.set(f.id, f.name);
  }

  const grouped: GroupedItems = new Map();

  for (const item of items) {
    const key = item.folderId ?? null;
    if (!grouped.has(key)) {
      grouped.set(key, {
        folderName: key ? (folderMap.get(key) ?? 'Unknown') : 'Unfiled',
        items: [],
      });
    }
    grouped.get(key)!.items.push(item);
  }

  return grouped;
}

/**
 * Get the subtitle to display for an Item (contextual based on type).
 */
export function itemSubtitle(item: BwItem): string | undefined {
  switch (item.type) {
    case ItemType.Login:
      return item.login?.username ?? undefined;
    case ItemType.Card:
      if (item.card?.cardholderName) return item.card.cardholderName;
      if (item.card?.brand && item.card.number) {
        return `${item.card.brand} *${item.card.number.slice(-4)}`;
      }
      return undefined;
    case ItemType.Identity:
      if (item.identity) {
        const parts = [item.identity.firstName, item.identity.lastName].filter(Boolean);
        return parts.length > 0 ? parts.join(' ') : undefined;
      }
      return undefined;
    case ItemType.SecureNote:
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Get the type label to display for an Item.
 */
export function itemTypeLabel(item: BwItem): string {
  switch (item.type) {
    case ItemType.Login:
      return 'Login';
    case ItemType.Card:
      return 'Card';
    case ItemType.Identity:
      return 'Identity';
    case ItemType.SecureNote:
      return 'Secure Note';
    default:
      return 'Unknown';
  }
}

function getLoginActions(login: BwItem['login']): ItemAction[] {
  const actions: ItemAction[] = [];
  if (login?.password) {
    actions.push({ label: 'Copy Password', value: login.password });
  } else if (login && login.password !== null) {
    actions.push({ label: 'Copy Password', value: '', fetchKind: 'password' });
  }
  if (login?.username) actions.push({ label: 'Copy Username', value: login.username });
  if (login?.totp) {
    actions.push({ label: 'Copy Verification Code', value: 'TOTP' });
  } else if (login && login.totp !== null) {
    actions.push({ label: 'Copy Verification Code', value: '', fetchKind: 'totp' });
  }
  if (login?.uris?.length) {
    const primaryUri = login.uris[0]?.uri;
    if (primaryUri) actions.push({ label: 'Open URL', value: primaryUri });
  }
  return actions;
}

function getCardActions(card: BwItem['card']): ItemAction[] {
  const actions: ItemAction[] = [];
  if (card?.number) {
    actions.push({ label: 'Copy Card Number', value: card.number });
  } else if (card && card.number !== null) {
    actions.push({ label: 'Copy Card Number', value: '', fetchKind: 'cardNumber' });
  }
  if (card?.code) {
    actions.push({ label: 'Copy Security Code', value: card.code });
  } else if (card && card.code !== null) {
    actions.push({ label: 'Copy Security Code', value: '', fetchKind: 'cardCode' });
  }
  return actions;
}

function getIdentityActions(identity: BwItem['identity']): ItemAction[] {
  const actions: ItemAction[] = [];
  if (identity?.firstName && identity?.lastName) {
    actions.push({ label: 'Copy Name', value: `${identity.firstName} ${identity.lastName}` });
  }
  if (identity?.email) actions.push({ label: 'Copy Email', value: identity.email });
  if (identity?.phone) actions.push({ label: 'Copy Phone', value: identity.phone });
  return actions;
}

/**
 * Get the list of actions for an Item based on its type.
 */
export function itemActions(item: BwItem): ItemAction[] {
  switch (item.type) {
    case ItemType.Login:
      return getLoginActions(item.login);
    case ItemType.Card:
      return getCardActions(item.card);
    case ItemType.Identity:
      return getIdentityActions(item.identity);
    default:
      return [];
  }
}

function trimToNull(v: unknown): string | null {
  return String(v ?? '').trim() || null;
}

function buildLoginFields(values: Record<string, string>): CreateItemPayload['login'] {
  return {
    username: trimToNull(values.username),
    password: trimToNull(values.password),
    totp: trimToNull(values.totp),
    uris: values.url?.trim() ? [{ uri: values.url.trim(), match: null }] : undefined,
  };
}

function buildCardFields(values: Record<string, string>): CreateItemPayload['card'] {
  return {
    cardholderName: trimToNull(values.cardholderName),
    brand: trimToNull(values.brand),
    number: trimToNull(values.number),
    expMonth: trimToNull(values.expMonth),
    expYear: trimToNull(values.expYear),
    code: trimToNull(values.code),
  };
}

function buildIdentityFields(values: Record<string, string>): CreateItemPayload['identity'] {
  return {
    title: trimToNull(values.title),
    firstName: trimToNull(values.firstName),
    middleName: trimToNull(values.middleName),
    lastName: trimToNull(values.lastName),
    email: trimToNull(values.email),
    phone: trimToNull(values.phone),
    address1: trimToNull(values.address1),
    address2: trimToNull(values.address2),
    city: trimToNull(values.city),
    state: trimToNull(values.state),
    postalCode: trimToNull(values.postalCode),
    country: trimToNull(values.country),
  };
}

/**
 * Serialize a form submission into the JSON structure `bw create item` expects.
 */
export function toCreatePayload(
  formValues: Record<string, string>,
  type: ItemTypeValue,
  folderId?: string | null,
  fields?: { name: string; value: string; type: number }[],
): CreateItemPayload {
  const base: CreateItemPayload = {
    type,
    name: formValues.name ?? '',
    notes: trimToNull(formValues.notes),
    folderId: folderId ?? null,
    favorite: false,
  };

  if (type === ItemType.Login) base.login = buildLoginFields(formValues);
  if (type === ItemType.Card) base.card = buildCardFields(formValues);
  if (type === ItemType.Identity) base.identity = buildIdentityFields(formValues);
  if (type === ItemType.SecureNote) base.secureNote = { type: 0 };
  if (fields && fields.length > 0) base.fields = fields;

  return base;
}

function fieldMarkdown(field: BwField): string {
  if (field.type === 1) return `- **${field.name}** — •••••••• (hidden)`;
  if (field.type === 2) return `- **${field.name}** — ${field.value === 'true' ? 'Yes' : 'No'}`;
  return `- **${field.name}** — ${field.value}`;
}

/**
 * Build a markdown detail string for an item.
 */
export function buildItemDetailMarkdown(item: BwItem): string {
  const lines: string[] = [];

  if (item.notes) {
    lines.push(`**Notes:**`, '', item.notes);
  }

  if (item.fields && item.fields.length > 0) {
    if (lines.length > 0) {
      lines.push('', '---', '');
    }
    lines.push('**Custom Fields:**', '');
    for (const field of item.fields) {
      lines.push(fieldMarkdown(field));
    }
  }

  return lines.join('\n');
}

/**
 * Map an ItemAction label to a Vicinae Icon.
 */
export function actionIcon(action: { label: string }): Image.ImageLike | undefined {
  switch (action.label) {
    case 'Copy Password':
      return Icon.Key;
    case 'Copy Username':
      return Icon.Person;
    case 'Copy Card Number':
      return Icon.CreditCard;
    case 'Copy Security Code':
      return Icon.Lock;
    case 'Copy Name':
      return Icon.Person;
    case 'Copy Email':
      return Icon.Envelope;
    case 'Copy Phone':
      return Icon.Phone;
    default:
      return undefined;
  }
}

// Icon SVG paths extracted from Vicinae's built-in icon set (src/server/icons/).
// These match the icons Vicinae uses natively so the composited versions look identical.
const SVG_PATHS: Partial<Record<ItemTypeValue, string>> = {
  [ItemType.Login]:
    'M7.5 5.5a3 3 0 1 1 3 3h-.75a.75.75 0 0 0-.53.22L7.44 10.5H6.25a.75.75 0 0 0-.75.75v1.136L4.43 13.5H2.5v-.593c0-.862.342-1.689.952-2.298L7.28 6.78a.75.75 0 0 0 .22-.53zm3-4.5A4.5 4.5 0 0 0 6 5.5v.439L2.39 9.55A4.75 4.75 0 0 0 1 12.906v1.343c0 .414.336.75.75.75h3a.75.75 0 0 0 .541-.23l1.5-1.563a.75.75 0 0 0 .209-.52V12h.75a.75.75 0 0 0 .53-.22L10.06 10h.44a4.5 4.5 0 1 0 0-9m.5 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2',
  [ItemType.Card]:
    'M3.75 3.5c-.69 0-1.25.56-1.25 1.25V6h11V4.75c0-.69-.56-1.25-1.25-1.25zm9.75 4h-11v3.75c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25zM1 4.75A2.75 2.75 0 0 1 3.75 2h8.5A2.75 2.75 0 0 1 15 4.75v6.5A2.75 2.75 0 0 1 12.25 14h-8.5A2.75 2.75 0 0 1 1 11.25zm3 5A.75.75 0 0 1 4.75 9h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 4 9.75',
  [ItemType.Identity]:
    'M8 2.5A1.75 1.75 0 1 0 8 6a1.75 1.75 0 0 0 0-3.5M4.75 4.25a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0M8 10c-2.034 0-3.771.948-4.44 2.58-.087.213-.046.402.11.576.173.194.479.344.83.344h7c.351 0 .657-.15.83-.344.156-.174.197-.363.11-.576C11.772 10.948 10.034 10 8 10m-5.828 2.012C3.135 9.662 5.544 8.5 8 8.5s4.865 1.161 5.828 3.512c.332.81.109 1.598-.38 2.144-.473.528-1.193.844-1.947.844H4.499c-.754 0-1.474-.316-1.947-.844-.489-.546-.712-1.334-.38-2.144',
  [ItemType.SecureNote]:
    'M4.75 2.5c-.69 0-1.25.56-1.25 1.25v8.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V7H9.75A1.75 1.75 0 0 1 8 5.25V2.5zm4.75.81v1.94c0 .138.112.25.25.25h1.94zM2 3.75A2.75 2.75 0 0 1 4.75 1h3.836c.464 0 .909.184 1.237.513l3.664 3.664c.329.328.513.773.513 1.237v5.836A2.75 2.75 0 0 1 11.25 15h-6.5A2.75 2.75 0 0 1 2 12.25z',
};

// Semantic colors from Vicinae's default theme (theme-file.cpp).
// Radius/margin/scale match renderBuiltinSvg: 25% radius, 15% margin, 70% icon.
const TYPE_COLORS: Partial<Record<ItemTypeValue, { light: string; dark: string }>> = {
  [ItemType.Login]: { light: '#1F6FEB', dark: '#2F6FED' }, // Blue
  [ItemType.Card]: { light: '#3A9C61', dark: '#3A9C61' }, // Green
  [ItemType.Identity]: { light: '#DA8A48', dark: '#F0883E' }, // Orange
  [ItemType.SecureNote]: { light: '#A48ED6', dark: '#BC8CFF' }, // Purple
};

function buildPlaceholderIcon(type: ItemTypeValue): Image.ImageLike {
  const path = SVG_PATHS[type];
  const color = TYPE_COLORS[type];
  if (!path || !color) return 'circle';

  const makeSvg = (bg: string) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect rx="4" ry="4" width="16" height="16" fill="${bg}"/><g transform="translate(2.4,2.4) scale(0.7)"><path fill="#fff" fill-rule="evenodd" d="${path}"/></g></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  };

  return { source: { light: makeSvg(color.light), dark: makeSvg(color.dark) } };
}

/** Get an icon for a list item. Uses processed favicons when available, falls back to themed placeholder icons. */
export function itemIcon(item: BwItem, favicons?: FaviconMap): Image.ImageLike {
  if (item.type === ItemType.Login) {
    const hostname = extractHostname(item.login?.uris);
    if (hostname) {
      const cached = favicons?.[hostname];
      if (cached !== undefined && cached !== '') {
        const fallback = buildPlaceholderIcon(ItemType.Login);
        const fallbackSource = (fallback as { source: { light: string; dark: string } }).source;
        return { source: cached, fallback: fallbackSource };
      }
    }
  }

  return buildPlaceholderIcon(item.type);
}
