import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import ItemDetailView, { renderItemActionElements } from '../item-detail-view';
import type { BwItem } from '../bitwarden-types';
import { ItemType } from '../bitwarden-types';

const { mockBw, mockPop } = vi.hoisted(() => {
  const mockBw = {
    getItem: vi.fn(),
    getTotp: vi.fn(),
    downloadAttachment: vi.fn(),
    getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
  };

  const mockPop = vi.fn();

  return { mockBw, mockPop };
});

const mockClipboardCopy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockShowToast = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

vi.mock('../bw-executor', () => ({
  ...mockBw,
  getErrorMessage: mockBw.getErrorMessage,
}));

vi.mock('../item-utils', () => ({
  buildItemDetailMarkdown: (item: BwItem) => (item.notes ? item.notes : ''),
  formatTotp: (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`,
  itemActions: (item: BwItem) => {
    const actions: { label: string; value?: string; fetchKind?: string; icon?: string }[] = [];
    if (item.login?.username) actions.push({ label: 'Copy Username', value: item.login.username });
    if (item.login?.password) actions.push({ label: 'Copy Password', value: item.login.password });
    if (item.login?.totp) actions.push({ label: 'Copy Verification Code', fetchKind: 'totp' });
    return actions;
  },
  itemTypeLabel: () => 'Login',
  actionIcon: () => undefined,
}));

vi.mock('./edit-item', () => ({
  default: () => React.createElement('div', { 'data-testid': 'edit-item' }),
}));

vi.mock('@vicinae/api', () => ({
  Action: Object.assign(
    ({ title, icon, onAction }: { title: string; icon?: string; onAction?: () => void }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': `action-${title.replace(/\s+/g, '-').toLowerCase()}`,
          onClick: onAction,
        },
        title,
      ),
    {
      CopyToClipboard: ({ title, content }: { title: string; content: string }) =>
        React.createElement(
          'button',
          { 'data-testid': `copy-${title.replace(/\s+/g, '-').toLowerCase()}`, title: content },
          title,
        ),
      OpenInBrowser: ({ title, url }: { title: string; url: string }) =>
        React.createElement('a', { 'data-testid': 'open-url', href: url }, title),
      SubmitForm: () => null,
      Style: { Destructive: 'destructive' },
    },
  ),
  ActionPanel: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'action-panel' }, children),
  Clipboard: { copy: (...args: unknown[]) => mockClipboardCopy(...args) },
  Detail: Object.assign(
    ({
      markdown,
      actions,
      metadata,
    }: {
      markdown: string;
      actions: React.ReactNode;
      metadata: React.ReactNode;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'detail-view' },
        React.createElement('div', { 'data-testid': 'markdown' }, markdown),
        React.createElement('div', { 'data-testid': 'metadata-wrapper' }, metadata),
        actions,
      ),
    {
      Metadata: Object.assign(
        ({ children }: { children: React.ReactNode }) =>
          React.createElement('div', { 'data-testid': 'metadata' }, children),
        {
          Label: ({ title, text }: { title: string; text: string }) =>
            React.createElement(
              'span',
              { 'data-testid': `metadata-${title.replace(/\s+/g, '-').toLowerCase()}` },
              `${title}: ${text}`,
            ),
          Separator: () => React.createElement('hr', { 'data-testid': 'metadata-separator' }),
        },
      ),
    },
  ),
  Icon: {
    ArrowLeft: 'arrow-left',
    CopyClipboard: 'copy',
    Eye: 'eye',
    Globe01: 'globe',
    Pencil: 'pencil',
    SaveDocument: 'save',
  },
  showToast: (...args: unknown[]) => mockShowToast(...args),
  Toast: { Style: { Success: 'success', Failure: 'failure' } },
  useNavigation: () => ({ pop: mockPop, push: mockPush }),
}));

vi.stubGlobal('setInterval', (cb: () => void, _ms: number) => {
  // Don't actually run intervals — just once for initial setup
  cb();
  return 123 as unknown as ReturnType<typeof setInterval>;
});
vi.stubGlobal('clearInterval', vi.fn());

function makeItem(overrides: Partial<BwItem> = {}): BwItem {
  return {
    id: 'item-1',
    organizationId: null,
    folderId: null,
    type: ItemType.Login,
    name: 'Test Login',
    notes: null,
    favorite: false,
    revisionDate: '',
    creationDate: '',
    deletedDate: null,
    collectionIds: null,
    login: { username: 'user', password: 'pass', totp: 'JBSWY3DPEHPK3PXP' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPop.mockReset();
  mockPush.mockReset();
});

// ---------------------------------------------------------------------------
// renderItemActionElements
// ---------------------------------------------------------------------------
describe('renderItemActionElements', () => {
  it('renders CopyToClipboard actions for simple values', () => {
    const actions = [
      { label: 'Copy Username', value: 'alice' },
      { label: 'Copy Password', value: 'secret' },
    ];
    const elements = renderItemActionElements(actions, vi.fn(), 'item-1', null);

    expect(elements).toHaveLength(2);
  });

  it('renders TOTP action that calls onCopyTotp', () => {
    const onCopyTotp = vi.fn();
    const actions = [
      { label: 'Copy Verification Code', fetchKind: 'totp' as const, value: '' as const },
    ];
    const elements = renderItemActionElements(actions, onCopyTotp, 'item-1', 'session');
    expect(elements).toHaveLength(1);
  });

  it('renders OpenInBrowser action', () => {
    const actions = [{ label: 'Open URL', value: 'https://example.com' as const }];
    const elements = renderItemActionElements(actions, vi.fn(), 'item-1', null);
    expect(elements).toHaveLength(1);
  });

  it('renders fetch-based actions that resolve with getItem', () => {
    const actions = [
      { label: 'Copy Card Number', fetchKind: 'cardNumber' as const, value: '' as const },
    ];
    const elements = renderItemActionElements(actions, vi.fn(), 'item-1', 'token');
    expect(elements).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ItemDetailView component
// ---------------------------------------------------------------------------
describe('ItemDetailView', () => {
  it('shows loading state with only Back action', async () => {
    mockBw.getItem.mockReturnValue(new Promise(() => {})); // never resolves

    render(
      React.createElement(ItemDetailView, {
        item: makeItem() as BwItem,
        session: 'token',
        onCopyTotp: vi.fn(),
      }),
    );

    expect(screen.getByTestId('markdown').textContent).toBe('Loading...');
    expect(screen.getByTestId('action-back')).toBeTruthy();
    expect(screen.queryByTestId('action-edit-item')).toBeNull();
  });

  it('shows content immediately when session is null', async () => {
    const item = makeItem({ notes: 'some note' });

    render(
      React.createElement(ItemDetailView, {
        item,
        session: null,
        onCopyTotp: vi.fn(),
      }),
    );

    // When session is null, setIsLoading(false) fires synchronously
    await waitFor(() => {
      expect(screen.getByTestId('markdown').textContent).toBe('some note');
    });
  });

  it('fetches item and shows content after loading', async () => {
    const fullItem = makeItem({ notes: 'My notes' });
    mockBw.getItem.mockResolvedValue(fullItem);

    render(
      React.createElement(ItemDetailView, {
        item: makeItem(),
        session: 'token',
        onCopyTotp: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(mockBw.getItem).toHaveBeenCalledWith('item-1', 'token');
    });

    await waitFor(() => {
      expect(screen.getByTestId('markdown').textContent).toBe('My notes');
    });
  });

  it('falls back to partial item when getItem fails', async () => {
    mockBw.getItem.mockRejectedValue(new Error('not found'));

    render(
      React.createElement(ItemDetailView, {
        item: makeItem(),
        session: 'token',
        onCopyTotp: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('detail-view')).toBeTruthy();
    });
    // Should not be loading
    expect(screen.getByTestId('markdown').textContent).not.toBe('Loading...');
  });

  it('shows full action panel after loading', async () => {
    mockBw.getItem.mockResolvedValue(makeItem());

    render(
      React.createElement(ItemDetailView, {
        item: makeItem(),
        session: 'token',
        onCopyTotp: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('action-edit-item')).toBeTruthy();
    });
  });

  it('fetches TOTP codes when item has totp', async () => {
    mockBw.getItem.mockResolvedValue(makeItem());
    mockBw.getTotp.mockResolvedValue('123456');

    render(
      React.createElement(ItemDetailView, {
        item: makeItem(),
        session: 'token',
        onCopyTotp: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(mockBw.getTotp).toHaveBeenCalledWith('item-1', 'token');
    });
  });

  it('navigates to edit view', async () => {
    mockBw.getItem.mockResolvedValue(makeItem());

    render(
      React.createElement(ItemDetailView, {
        item: makeItem(),
        session: 'token',
        onCopyTotp: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('action-edit-item')).toBeTruthy();
    });

    screen.getByTestId('action-edit-item').click();

    expect(mockPush).toHaveBeenCalled();
  });
});
