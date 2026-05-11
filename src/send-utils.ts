import { Icon } from '@vicinae/api';
import type { Image } from '@vicinae/api';
import type { BwSend, CreateSendPayload, SendAction } from './send-types';
import { SendType } from './send-types';
import type { SendTypeValue } from './send-types';
import { getPreferences, getServerUrl } from './preferences';
import { trimToNull } from './item-utils';

export function filterSends(sends: BwSend[], query: string): BwSend[] {
  if (!query.trim()) return sends;
  const lower = query.toLowerCase();
  return sends.filter((send) => send.name.toLowerCase().includes(lower));
}

export function sendTypeLabel(send: BwSend): string {
  return send.type === SendType.File ? 'File' : 'Text';
}

export function sendSubtitle(send: BwSend): string {
  if (send.type === SendType.File && send.file?.fileName) {
    return `File: ${send.file.fileName}`;
  }
  if (send.type === SendType.Text && send.text?.text) {
    const preview = send.text.text.slice(0, 60);
    return send.text.text.length > 60 ? `${preview}…` : preview;
  }
  return sendTypeLabel(send);
}

export function sendActions(send: BwSend): SendAction[] {
  const actions: SendAction[] = [{ label: 'Copy Send Link', value: sendAccessUrl(send) }];
  if (send.type === SendType.Text && send.text?.text) {
    actions.push({ label: 'Copy Text', value: send.text.text });
  }
  return actions;
}

export function sendActionIcon(action: { label: string }): Image.ImageLike | undefined {
  switch (action.label) {
    case 'Copy Send Link':
      return Icon.Link;
    case 'Copy Text':
      return Icon.CopyClipboard;
    default:
      return undefined;
  }
}

export function sendAccessUrl(send: BwSend): string {
  try {
    const prefs = getPreferences();
    const serverUrl = getServerUrl(prefs);
    const base = serverUrl.replace(/\/+$/, '');
    return `${base}/#/send/${send.accessId}`;
  } catch {
    return `https://vault.bitwarden.com/#/send/${send.accessId}`;
  }
}

export function daysUntilDeletion(send: BwSend): number | null {
  if (!send.deletionDate) return null;
  const now = Date.now();
  const deletion = new Date(send.deletionDate).getTime();
  if (isNaN(deletion)) return null;
  const diff = deletion - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function buildDeletionCountdown(send: BwSend): string {
  const days = daysUntilDeletion(send);
  if (days === null) return '';
  if (days === 0) return 'Today';
  return `${days}d`;
}

export function toSendPayload(
  formValues: Record<string, string>,
  type: SendTypeValue,
): CreateSendPayload {
  const deletionDays = Number(formValues.deletionDays) || 7;
  const deletionDate = new Date(Date.now() + deletionDays * 24 * 60 * 60 * 1000).toISOString();

  const rawMaxAccess = Number(formValues.maxAccessCount);
  const maxAccessCount =
    !isNaN(rawMaxAccess) && formValues.maxAccessCount?.trim() ? rawMaxAccess : null;

  const password = trimToNull(formValues.password);

  const payload: CreateSendPayload = {
    name: formValues.name ?? '',
    notes: trimToNull(formValues.notes),
    type,
    password,
    maxAccessCount,
    deletionDate,
    expirationDate: null,
    text: null,
    file: null,
  };

  if (type === SendType.Text) {
    payload.text = {
      text: formValues.textContent ?? '',
      hidden: formValues.hideText === 'true',
    };
  }

  if (type === SendType.File) {
    payload.file = {
      fileName: formValues.fileName ?? '',
    };
  }

  return payload;
}
