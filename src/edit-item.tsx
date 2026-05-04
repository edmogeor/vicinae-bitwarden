import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  Icon,
  popToRoot,
  showToast,
  Toast,
} from "@vicinae/api";
import { useCallback, useEffect, useRef, useState } from "react";
import React from "react";
import * as bw from "./bw-executor";
import type { BwFolder, BwItem } from "./bitwarden-types";
import { ItemType } from "./bitwarden-types";
import type { ItemTypeValue } from "./bitwarden-types";
import { toCreatePayload } from "./item-utils";

const CARD_BRANDS = ["Visa", "Mastercard", "Amex", "Discover", "Other"];

interface EditItemProps {
  item: BwItem;
  session: string;
  onSaved: () => void;
}

interface CustomField {
  id: number;
  name: string;
  value: string;
}

export default function EditItem({ item, session, onSaved }: EditItemProps) {
  const [fullItem, setFullItem] = useState<BwItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [folders, setFolders] = useState<BwFolder[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const fieldIdRef = useRef(0);

  useEffect(() => {
    void (async () => {
      let resolved: BwItem;
      try {
        resolved = await bw.getItem(item.id, session);
      } catch {
        resolved = item;
      }

      setFullItem(resolved);

      if (resolved.fields && resolved.fields.length > 0) {
        setCustomFields(
          resolved.fields.map((f, i) => ({
            id: i,
            name: f.name,
            value: f.value,
          })),
        );
        fieldIdRef.current = resolved.fields.length;
      }

      setIsLoading(false);

      try {
        setFolders(await bw.listFolders(session));
      } catch {
        // Folder list is optional
      }
    })();
  }, [item.id, session]);

  const handleSubmit = useCallback(
    async (values: Form.Values) => {
      setIsSubmitting(true);
      try {
        const formValues: Record<string, string> = {};
        for (const [key, val] of Object.entries(values)) {
          formValues[key] = String(val ?? "");
        }

        const fields = customFields.length > 0
          ? customFields.map(f => ({ name: f.name, value: f.value, type: 0 }))
          : undefined;

        const payload = toCreatePayload(
          formValues,
          item.type as ItemTypeValue,
          formValues.folder || null,
          fields,
        );
        await bw.editItem(item.id, payload, session);
        await showToast({ style: Toast.Style.Success, title: "Item updated", message: formValues.name });
        onSaved();
        await popToRoot();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await showToast({ style: Toast.Style.Failure, title: "Failed to update item", message });
      } finally {
        setIsSubmitting(false);
      }
    },
    [item.id, item.type, session, onSaved, customFields],
  );

  if (isLoading || !fullItem) {
    return (
      <Form>
        <Form.Description text="Loading..." />
      </Form>
    );
  }

  const typeLabel = getTypeLabel(item.type);
  const folderId = fullItem.folderId ?? "";

  const handleDelete = useCallback(async () => {
    const confirmed = await confirmAlert({
      title: "Delete Item",
      message: `Are you sure you want to delete "${item.name}"?`,
      primaryAction: {
        title: "Delete",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;
    try {
      await bw.deleteItem(item.id, session);
      await showToast({ style: Toast.Style.Success, title: "Item deleted", message: item.name });
      onSaved();
      await popToRoot();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await showToast({ style: Toast.Style.Failure, title: "Delete failed", message });
    }
  }, [item.id, item.name, session, onSaved]);

  return (
    <Form
      isLoading={isSubmitting}
      navigationTitle={`Edit ${fullItem.name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Changes" icon={Icon.CheckCircle} onSubmit={handleSubmit} />
          {item.type === ItemType.Login && fullItem.login?.password && (
            <Action
              title={showPassword ? "Hide Password" : "Show Password"}
              icon={Icon.Eye}
              onAction={() => setShowPassword(prev => !prev)}
            />
          )}
          <Action
            title="Add Custom Field"
            icon={Icon.Plus}
            onAction={() => setCustomFields(prev => [...prev, { id: fieldIdRef.current++, name: "", value: "" }])}
          />
          <Action
            title="Delete Item"
            icon={Icon.Trash}
            onAction={handleDelete}
          />
        </ActionPanel>
      }
    >
      <Form.Description text={`Type: ${typeLabel}`} />

      {folders.length > 0 && (
        <Form.Dropdown id="folder" title="Folder" defaultValue={folderId}>
          {folders.map((f) => (
            <Form.Dropdown.Item key={f.id} value={f.id} title={f.name} />
          ))}
        </Form.Dropdown>
      )}

      <Form.Separator />

      <Form.TextField id="name" title="Name" defaultValue={fullItem.name} />

      {item.type === ItemType.Login && fullItem.login && (
        <>
          <Form.TextField id="username" title="Username" defaultValue={fullItem.login.username ?? ""} />
          {showPassword ? (
            <Form.TextField id="password" title="Password" defaultValue={fullItem.login.password ?? ""} />
          ) : (
            <Form.PasswordField id="password" title="Password" defaultValue={fullItem.login.password ?? ""} />
          )}
          <Form.TextField id="url" title="URL" defaultValue={fullItem.login.uris?.[0]?.uri ?? ""} />
          <Form.TextField id="totp" title="TOTP Secret" defaultValue={fullItem.login.totp ?? ""} />
        </>
      )}

      {item.type === ItemType.Card && fullItem.card && (
        <>
          <Form.TextField id="cardholderName" title="Cardholder Name" defaultValue={fullItem.card.cardholderName ?? ""} />
          <Form.Dropdown id="brand" title="Brand" defaultValue={fullItem.card.brand ?? "Other"}>
            {CARD_BRANDS.map((b) => (
              <Form.Dropdown.Item key={b} value={b} title={b} />
            ))}
          </Form.Dropdown>
          <Form.TextField id="number" title="Card Number" defaultValue={fullItem.card.number ?? ""} />
          <Form.TextField id="expMonth" title="Expiration Month" defaultValue={fullItem.card.expMonth ?? ""} />
          <Form.TextField id="expYear" title="Expiration Year" defaultValue={fullItem.card.expYear ?? ""} />
          <Form.TextField id="code" title="Security Code" defaultValue={fullItem.card.code ?? ""} />
        </>
      )}

      {item.type === ItemType.Identity && fullItem.identity && (
        <>
          <Form.TextField id="title" title="Title" defaultValue={fullItem.identity.title ?? ""} />
          <Form.TextField id="firstName" title="First Name" defaultValue={fullItem.identity.firstName ?? ""} />
          <Form.TextField id="middleName" title="Middle Name" defaultValue={fullItem.identity.middleName ?? ""} />
          <Form.TextField id="lastName" title="Last Name" defaultValue={fullItem.identity.lastName ?? ""} />
          <Form.TextField id="email" title="Email" defaultValue={fullItem.identity.email ?? ""} />
          <Form.TextField id="phone" title="Phone" defaultValue={fullItem.identity.phone ?? ""} />
          <Form.Separator />
          <Form.TextField id="address1" title="Address Line 1" defaultValue={fullItem.identity.address1 ?? ""} />
          <Form.TextField id="address2" title="Address Line 2" defaultValue={fullItem.identity.address2 ?? ""} />
          <Form.TextField id="city" title="City" defaultValue={fullItem.identity.city ?? ""} />
          <Form.TextField id="state" title="State" defaultValue={fullItem.identity.state ?? ""} />
          <Form.TextField id="postalCode" title="Postal Code" defaultValue={fullItem.identity.postalCode ?? ""} />
          <Form.TextField id="country" title="Country" defaultValue={fullItem.identity.country ?? ""} />
        </>
      )}

      {item.type === ItemType.SecureNote && (
        <Form.Description text="A Secure Note stores arbitrary text. Use the Notes field below for the content." />
      )}

      <Form.Separator />

      <Form.TextArea id="notes" title="Notes" defaultValue={fullItem.notes ?? ""} />

      {customFields.length > 0 && (
        <>
          <Form.Separator />
          <Form.Description text="Custom Fields" />
        </>
      )}
      {customFields.map((field) => (
        <React.Fragment key={field.id}>
          <Form.TextField
            id={`cf_name_${field.id}`}
            title="Field Name"
            value={field.name}
            onChange={(v) => setCustomFields(prev =>
              prev.map(f => f.id === field.id ? { ...f, name: String(v ?? "") } : f)
            )}
          />
          <Form.TextField
            id={`cf_value_${field.id}`}
            title="Field Value"
            value={field.value}
            onChange={(v) => setCustomFields(prev =>
              prev.map(f => f.id === field.id ? { ...f, value: String(v ?? "") } : f)
            )}
          />
        </React.Fragment>
      ))}
    </Form>
  );
}

function getTypeLabel(type: number): string {
  switch (type) {
    case ItemType.Login: return "Login";
    case ItemType.Card: return "Card";
    case ItemType.Identity: return "Identity";
    case ItemType.SecureNote: return "Secure Note";
    default: return "Unknown";
  }
}
