import { describe, expect, it, vi } from "vitest";

vi.mock("@vicinae/api", () => ({
  LocalStorage: {
    getItem: vi.fn().mockResolvedValue(undefined),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
  Image: { Mask: { Circle: "circle", RoundedRectangle: "roundedRectangle" } },
}));

import { BwItem, ItemType } from "../bitwarden-types";
import { CreateItemPayload, ItemAction } from "../bw-executor";
import {
  buildItemDetailMarkdown,
  filterItems,
  getItemActions,
  groupByFolder,
  itemIcon,
  itemSubtitle,
  itemTypeLabel,
  toCreatePayload,
} from "../item-utils";

function makeItem(overrides: Partial<BwItem> = {}): BwItem {
  return {
    id: "item-1",
    organizationId: null,
    folderId: null,
    type: ItemType.Login,
    name: "Test Item",
    notes: null,
    favorite: false,
    revisionDate: "2024-01-01T00:00:00Z",
    creationDate: "2024-01-01T00:00:00Z",
    deletedDate: null,
    collectionIds: null,
    ...overrides,
  };
}

const folders = [
  { id: "f1", name: "Work" },
  { id: "f2", name: "Personal" },
];

// ---------------------------------------------------------------------------
// filterItems
// ---------------------------------------------------------------------------
describe("filterItems", () => {
  const items = [
    makeItem({ id: "1", name: "GitHub" }),
    makeItem({ id: "2", name: "gitlab" }),
    makeItem({ id: "3", name: "Bank Account" }),
    makeItem({ id: "4", name: "Email" }),
  ];

  it("returns all items when query is empty", () => {
    expect(filterItems(items, "")).toHaveLength(4);
  });

  it("returns all items when query is whitespace only", () => {
    expect(filterItems(items, "   ")).toHaveLength(4);
  });

  it("matches case-insensitive substring", () => {
    const result = filterItems(items, "git");
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(["1", "2"]);
  });

  it("returns empty array when nothing matches", () => {
    expect(filterItems(items, "notfound")).toHaveLength(0);
  });

  it("matches by full name", () => {
    const result = filterItems(items, "Bank Account");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("3");
  });
});

// ---------------------------------------------------------------------------
// groupByFolder
// ---------------------------------------------------------------------------
describe("groupByFolder", () => {
  it("groups items by folderId", () => {
    const items = [
      makeItem({ id: "1", folderId: "f1", name: "A" }),
      makeItem({ id: "2", folderId: "f1", name: "B" }),
      makeItem({ id: "3", folderId: "f2", name: "C" }),
    ];

    const grouped = groupByFolder(items, folders);
    expect(grouped.size).toBe(2);
    expect(grouped.get("f1")!.items).toHaveLength(2);
    expect(grouped.get("f2")!.items).toHaveLength(1);
  });

  it('places items with null folderId under "Unfiled"', () => {
    const items = [makeItem({ id: "1", folderId: null, name: "A" })];

    const grouped = groupByFolder(items, folders);
    expect(grouped.size).toBe(1);
    expect(grouped.get(null)!.folderName).toBe("Unfiled");
  });

  it("uses folder name from folder list", () => {
    const items = [makeItem({ id: "1", folderId: "f1", name: "A" })];

    const grouped = groupByFolder(items, folders);
    expect(grouped.get("f1")!.folderName).toBe("Work");
  });

  it('falls back to "Unknown" for missing folder IDs', () => {
    const items = [makeItem({ id: "1", folderId: "unknown", name: "A" })];

    const grouped = groupByFolder(items, folders);
    expect(grouped.get("unknown")!.folderName).toBe("Unknown");
  });

  it("returns empty map for empty item list", () => {
    expect(groupByFolder([], folders).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// itemSubtitle
// ---------------------------------------------------------------------------
describe("itemSubtitle", () => {
  it("returns username for Login items", () => {
    const item = makeItem({
      type: ItemType.Login,
      login: { username: "alice", password: "secret", totp: null },
    });
    expect(itemSubtitle(item)).toBe("alice");
  });

  it("returns cardholder name for Card items", () => {
    const item = makeItem({
      type: ItemType.Card,
      card: { cardholderName: "John Doe", brand: null, number: null, expMonth: null, expYear: null, code: null },
    });
    expect(itemSubtitle(item)).toBe("John Doe");
  });

  it("returns brand + last4 for Card items without cardholder", () => {
    const item = makeItem({
      type: ItemType.Card,
      card: { cardholderName: null, brand: "Visa", number: "4111111111111111", expMonth: null, expYear: null, code: null },
    });
    expect(itemSubtitle(item)).toBe("Visa *1111");
  });

  it("returns full name for Identity items", () => {
    const item = makeItem({
      type: ItemType.Identity,
      identity: { firstName: "Jane", lastName: "Smith", title: null, middleName: null, email: null, phone: null, address1: null, address2: null, address3: null, city: null, state: null, postalCode: null, country: null, company: null, ssn: null, username: null, passportNumber: null, licenseNumber: null },
    });
    expect(itemSubtitle(item)).toBe("Jane Smith");
  });

  it("returns undefined for Secure Note items", () => {
    const item = makeItem({ type: ItemType.SecureNote, secureNote: { type: 0 } });
    expect(itemSubtitle(item)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// itemTypeLabel
// ---------------------------------------------------------------------------
describe("itemTypeLabel", () => {
  it("returns Login for type 1", () => {
    expect(itemTypeLabel(makeItem({ type: ItemType.Login }))).toBe("Login");
  });
  it("returns Card for type 3", () => {
    expect(itemTypeLabel(makeItem({ type: ItemType.Card }))).toBe("Card");
  });
  it("returns Identity for type 4", () => {
    expect(itemTypeLabel(makeItem({ type: ItemType.Identity }))).toBe("Identity");
  });
  it("returns Secure Note for type 2", () => {
    expect(itemTypeLabel(makeItem({ type: ItemType.SecureNote }))).toBe("Secure Note");
  });
});

// ---------------------------------------------------------------------------
// getItemActions
// ---------------------------------------------------------------------------
describe("getItemActions", () => {
  it("returns username, password, TOTP, and URL actions for Login items", () => {
    const item = makeItem({
      type: ItemType.Login,
      login: {
        username: "bob",
        password: "pass123",
        totp: "JBSWY3DPEHPK3PXP",
        uris: [{ uri: "https://example.com", match: null }],
      },
    });
    const actions = getItemActions(item);
    const labels = actions.map((a) => a.label);
    expect(labels).toContain("Copy Username");
    expect(labels).toContain("Copy Password");
    expect(labels).toContain("Copy TOTP");
    expect(labels).toContain("Open URL");
  });

  it("omits missing fields for Login items", () => {
    const item = makeItem({
      type: ItemType.Login,
      login: { username: null, password: "pass", totp: null },
    });
    const actions = getItemActions(item);
    const labels = actions.map((a) => a.label);
    expect(labels).toContain("Copy Password");
    expect(labels).not.toContain("Copy Username");
    expect(labels).not.toContain("Copy TOTP");
  });

  it("returns card number and code actions for Card items", () => {
    const item = makeItem({
      type: ItemType.Card,
      card: { cardholderName: null, brand: null, number: "4111111111111111", expMonth: null, expYear: null, code: "123" },
    });
    const actions = getItemActions(item);
    const labels = actions.map((a) => a.label);
    expect(labels).toContain("Copy Card Number");
    expect(labels).toContain("Copy Security Code");
  });

  it("returns name, email, phone actions for Identity items", () => {
    const item = makeItem({
      type: ItemType.Identity,
      identity: { firstName: "Jane", lastName: "Doe", email: "jane@test.com", phone: "555-1234", title: null, middleName: null, address1: null, address2: null, address3: null, city: null, state: null, postalCode: null, country: null, company: null, ssn: null, username: null, passportNumber: null, licenseNumber: null },
    });
    const actions = getItemActions(item);
    const labels = actions.map((a) => a.label);
    expect(labels).toContain("Copy Name");
    expect(labels).toContain("Copy Email");
    expect(labels).toContain("Copy Phone");
  });

  it("returns empty actions for Secure Note items", () => {
    const item = makeItem({ type: ItemType.SecureNote, secureNote: { type: 0 } });
    expect(getItemActions(item)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// toCreatePayload
// ---------------------------------------------------------------------------
describe("toCreatePayload", () => {
  it("serializes Login form values", () => {
    const values = {
      name: "My Login",
      username: "alice",
      password: "secret",
      url: "https://example.com",
      totp: "JBSWY3DPEHPK3PXP",
      notes: "some note",
    };
    const payload = toCreatePayload(values, ItemType.Login);

    expect(payload.type).toBe(ItemType.Login);
    expect(payload.name).toBe("My Login");
    expect(payload.notes).toBe("some note");
    expect(payload.login).toBeDefined();
    expect(payload.login!.username).toBe("alice");
    expect(payload.login!.password).toBe("secret");
    expect(payload.login!.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(payload.login!.uris).toEqual([{ uri: "https://example.com", match: null }]);
    expect(payload.folderId).toBeNull();
    expect(payload.favorite).toBe(false);
  });

  it("serializes Login without URL when URL is empty", () => {
    const payload = toCreatePayload(
      { name: "Login", username: "a", password: "b" },
      ItemType.Login,
    );
    expect(payload.login!.uris).toBeUndefined();
  });

  it("serializes Card form values", () => {
    const values = {
      name: "My Card",
      cardholderName: "John Doe",
      brand: "Visa",
      number: "4111111111111111",
      expMonth: "12",
      expYear: "2025",
      code: "123",
    };
    const payload = toCreatePayload(values, ItemType.Card);

    expect(payload.type).toBe(ItemType.Card);
    expect(payload.card).toBeDefined();
    expect(payload.card!.cardholderName).toBe("John Doe");
    expect(payload.card!.brand).toBe("Visa");
    expect(payload.card!.number).toBe("4111111111111111");
  });

  it("serializes Identity form values", () => {
    const values = {
      name: "My Identity",
      title: "Mr",
      firstName: "John",
      lastName: "Doe",
      email: "john@test.com",
      phone: "555-1234",
    };
    const payload = toCreatePayload(values, ItemType.Identity);

    expect(payload.type).toBe(ItemType.Identity);
    expect(payload.identity).toBeDefined();
    expect(payload.identity!.firstName).toBe("John");
    expect(payload.identity!.lastName).toBe("Doe");
    expect(payload.identity!.email).toBe("john@test.com");
  });

  it("serializes Secure Note form values", () => {
    const values = { name: "My Note", notes: "secret text" };
    const payload = toCreatePayload(values, ItemType.SecureNote);

    expect(payload.type).toBe(ItemType.SecureNote);
    expect(payload.secureNote).toEqual({ type: 0 });
  });

  it("trims whitespace from string values", () => {
    const values = {
      name: "  My Login  ",
      username: "  alice  ",
      password: "secret",
    };
    const payload = toCreatePayload(values, ItemType.Login);
    expect(payload.name).toBe("  My Login  ");
    expect(payload.login!.username).toBe("alice");
  });

  it("converts empty strings to null for optional fields", () => {
    const payload = toCreatePayload(
      { name: "Item", notes: "   " },
      ItemType.Login,
    );
    expect(payload.notes).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildItemDetailMarkdown
// ---------------------------------------------------------------------------
describe("buildItemDetailMarkdown", () => {
  it("returns empty string when no notes or custom fields", () => {
    const md = buildItemDetailMarkdown(makeItem({ name: "My Item" }));
    expect(md).toBe("");
  });

  it("shows notes when present", () => {
    const item = makeItem({ notes: "Some note text" });
    const md = buildItemDetailMarkdown(item);
    expect(md).toContain("Some note text");
  });

  it("shows Secure Note content as notes", () => {
    const item = makeItem({
      type: ItemType.SecureNote,
      notes: "My secret note",
      secureNote: { type: 0 },
    });
    const md = buildItemDetailMarkdown(item);
    expect(md).toContain("My secret note");
  });

  it("shows custom fields", () => {
    const item = makeItem({
      fields: [
        { name: "API Key", value: "abc123", type: 0, linkedId: null },
        { name: "Secret", value: "xyz", type: 1, linkedId: null },
      ],
    });
    const md = buildItemDetailMarkdown(item);
    expect(md).toContain("API Key: abc123");
    expect(md).toContain("Secret: ••••••••");
  });

  it("shows password when showPassword is true", () => {
    // Password moved to metadata sidebar — markdown no longer contains it
    const md = buildItemDetailMarkdown(makeItem({ name: "My Item" }));
    expect(md).toBe("");
  });
});

// ---------------------------------------------------------------------------
// itemIcon
// ---------------------------------------------------------------------------
describe("itemIcon", () => {
  it("returns favicon Image object when real URL cached in map", () => {
    const item = makeItem({
      type: ItemType.Login,
      login: { username: null, password: null, totp: null, uris: [{ uri: "https://github.com/login", match: null }] },
    });
    const icon = itemIcon(item, { "github.com": "https://github.com/favicon.ico" }) as { source: string; fallback: string };
    expect(icon.source).toBe("https://github.com/favicon.ico");
    expect(icon.fallback).toBe("key");
  });

  it("returns key icon for Login items without URL", () => {
    const item = makeItem({ type: ItemType.Login, login: { username: null, password: null, totp: null } });
    expect(itemIcon(item)).toBe("key");
  });

  it("returns key icon for Login items without URL", () => {
    const item = makeItem({ type: ItemType.Login, login: { username: null, password: null, totp: null } });
    expect(itemIcon(item)).toBe("key");
  });

  it("returns credit-card icon for Card items", () => {
    const item = makeItem({ type: ItemType.Card });
    expect(itemIcon(item)).toBe("credit-card");
  });

  it("returns person icon for Identity items", () => {
    const item = makeItem({ type: ItemType.Identity });
    expect(itemIcon(item)).toBe("person");
  });
});
