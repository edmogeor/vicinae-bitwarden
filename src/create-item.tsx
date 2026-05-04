import {
  Action,
  ActionPanel,
  Form,
  popToRoot,
  showToast,
  Toast,
} from "@vicinae/api";
import { useCallback, useEffect, useState } from "react";
import * as bw from "./bw-executor";
import type { BwFolder } from "./bitwarden-types";
import { ItemType } from "./bitwarden-types";
import type { ItemTypeValue } from "./bitwarden-types";
import { toCreatePayload } from "./item-utils";
import { useSession } from "./use-session";
import { checkBwGate, renderUnlockGate, useUnlockGate } from "./unlock-gate";

type UIState =
  | { kind: "checking-bw" }
  | { kind: "bw-not-installed" }
  | { kind: "logging-in" }
  | { kind: "needs-unlock"; error?: string }
  | { kind: "unlocking" }
  | { kind: "form" };

const ITEM_TYPE_MAP: Record<string, ItemTypeValue> = {
  Login: ItemType.Login,
  Card: ItemType.Card,
  Identity: ItemType.Identity,
  "Secure Note": ItemType.SecureNote,
};

const ITEM_TYPE_OPTIONS = Object.keys(ITEM_TYPE_MAP).map((label) => ({
  value: label,
  label,
}));

const CARD_BRANDS = ["Visa", "Mastercard", "Amex", "Discover", "Other"];

export default function CreateItem() {
  const { session, unlock, loginIfNeeded, loginError } = useSession();
  const [state, setState] = useState<UIState>({ kind: "checking-bw" });
  const [selectedType, setSelectedType] = useState<string>("Login");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [folders, setFolders] = useState<BwFolder[]>([]);

  const { handleLogin, handleUnlock } = useUnlockGate({
    loginIfNeeded,
    loginError,
    unlock,
    onUnlockStart: () => setState({ kind: "unlocking" }),
    onUnlockReady: () => setState({ kind: "form" }),
    onUnlockError: (error) => setState({ kind: "needs-unlock", error }),
    onLoginReady: () => setState({ kind: "needs-unlock" }),
    onLoginError: (error) => setState({ kind: "needs-unlock", error }),
  });

  useEffect(() => {
    void (async () => {
      const gate = await checkBwGate(session);
      switch (gate.kind) {
        case "bw-not-installed":
        case "logging-in":
        case "needs-unlock":
          setState({ kind: gate.kind });
          return;
        case "ready":
          setState({ kind: "form" });
          return;
      }
    })();
  }, []);

  // When session becomes available after mount, transition to form
  useEffect(() => {
    if (!session) return;
    if (state.kind !== "needs-unlock") return;
    setState({ kind: "form" });
  }, [session, state.kind]);

  // Login effect
  useEffect(() => {
    if (state.kind !== "logging-in") return;
    void handleLogin();
  }, [state.kind]);

  // Fetch folders for the folder dropdown
  useEffect(() => {
    if (state.kind !== "form" || !session) return;
    void (async () => {
      try {
        const folderList = await bw.listFolders(session);
        setFolders(folderList);
      } catch {
        // Folder list is optional — form still works without it
      }
    })();
  }, [state.kind, session]);

  const handleSubmit = useCallback(
    async (values: Form.Values) => {
      if (!session) return;

      const itemValues: Record<string, string> = {};
      for (const [key, val] of Object.entries(values)) {
        itemValues[key] = String(val ?? "");
      }

      const typeNum = ITEM_TYPE_MAP[selectedType] ?? ItemType.SecureNote;

      setIsSubmitting(true);
      try {
        const payload = toCreatePayload(itemValues, typeNum, itemValues.folder || null);
        await bw.createItem(payload, session);
        await showToast({
          style: Toast.Style.Success,
          title: "Item created",
          message: itemValues.name,
        });
        await popToRoot();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to create item",
          message,
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [session, selectedType],
  );

  const gateRender = renderUnlockGate(
    state.kind,
    state.kind === "needs-unlock" ? state.error : undefined,
    handleUnlock,
  );
  if (gateRender) return gateRender;

  if (state.kind === "checking-bw" || state.kind === "logging-in") {
    return (
      <Form>
        <Form.Description text="Loading..." />
      </Form>
    );
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Item" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="itemType"
        title="Item Type"
        value={selectedType}
        onChange={(value) => setSelectedType(String(value ?? "Login"))}
      >
        {ITEM_TYPE_OPTIONS.map((opt) => (
          <Form.Dropdown.Item key={opt.value} value={opt.value} title={opt.label} />
        ))}
      </Form.Dropdown>

      {folders.length > 0 && (
        <Form.Dropdown id="folder" title="Folder" defaultValue="">
          <Form.Dropdown.Item value="" title="None" />
          {folders.map((f) => (
            <Form.Dropdown.Item key={f.id} value={f.id} title={f.name} />
          ))}
        </Form.Dropdown>
      )}

      <Form.Separator />

      <Form.TextField id="name" title="Name" />

      {selectedType === "Login" && (
        <>
          <Form.TextField id="username" title="Username" />
          <Form.PasswordField id="password" title="Password" />
          <Form.TextField id="url" title="URL" />
          <Form.TextField id="totp" title="TOTP Secret" />
        </>
      )}

      {selectedType === "Card" && (
        <>
          <Form.TextField id="cardholderName" title="Cardholder Name" />
          <Form.Dropdown id="brand" title="Brand" defaultValue="Other">
            {CARD_BRANDS.map((b) => (
              <Form.Dropdown.Item key={b} value={b} title={b} />
            ))}
          </Form.Dropdown>
          <Form.TextField id="number" title="Card Number" />
          <Form.TextField id="expMonth" title="Expiration Month" />
          <Form.TextField id="expYear" title="Expiration Year" />
          <Form.TextField id="code" title="Security Code" />
        </>
      )}

      {selectedType === "Identity" && (
        <>
          <Form.TextField id="title" title="Title" />
          <Form.TextField id="firstName" title="First Name" />
          <Form.TextField id="middleName" title="Middle Name" />
          <Form.TextField id="lastName" title="Last Name" />
          <Form.TextField id="email" title="Email" />
          <Form.TextField id="phone" title="Phone" />
          <Form.Separator />
          <Form.TextField id="address1" title="Address Line 1" />
          <Form.TextField id="address2" title="Address Line 2" />
          <Form.TextField id="city" title="City" />
          <Form.TextField id="state" title="State" />
          <Form.TextField id="postalCode" title="Postal Code" />
          <Form.TextField id="country" title="Country" />
        </>
      )}

      {selectedType === "Secure Note" && (
        <Form.Description text="A Secure Note stores arbitrary text. Use the Notes field below for the content." />
      )}

      <Form.Separator />

      <Form.TextArea id="notes" title="Notes" />
    </Form>
  );
}
