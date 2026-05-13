import { LocalStorage } from '@vicinae/api';
import { BwItem, BwFolder } from './bitwarden-types';
import type { BwSend } from './send-types';

const CACHE_KEY = 'vicinae-bitwarden-cache';

interface CachedVault {
  items: BwItem[];
  folders: BwFolder[];
  timestamp: number;
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

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
  stripped.attachments = [];

  return stripped;
}

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

const SENDS_CACHE_KEY = 'vicinae-bitwarden-sends-cache';

interface CachedSends {
  sends: BwSend[];
  timestamp: number;
}

const SENDS_CACHE_TTL = 24 * 60 * 60 * 1000;

function stripSensitiveSendFields(send: BwSend): BwSend {
  return {
    ...send,
    notes: null,
    text: send.text ? { text: '', hidden: send.text.hidden } : null,
  };
}

export async function loadCachedSends(): Promise<BwSend[] | null> {
  try {
    const raw = await LocalStorage.getItem<string>(SENDS_CACHE_KEY);
    if (!raw) return null;
    const cached: CachedSends = JSON.parse(raw);
    if (Date.now() - cached.timestamp > SENDS_CACHE_TTL) return null;
    return cached.sends;
  } catch {
    return null;
  }
}

export async function saveCachedSends(sends: BwSend[]): Promise<void> {
  const cache: CachedSends = {
    sends: sends.map(stripSensitiveSendFields),
    timestamp: Date.now(),
  };
  await LocalStorage.setItem(SENDS_CACHE_KEY, JSON.stringify(cache));
}

export async function clearCachedSends(): Promise<void> {
  await LocalStorage.removeItem(SENDS_CACHE_KEY);
}
