import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  confirmAlert,
  Detail,
  Form,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@vicinae/api";
import type { Image } from "@vicinae/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BwNotInstalled } from "./bw-not-installed";
import * as bw from "./bw-executor";
import {
  buildItemDetailMarkdown,
  clearCachedVault,
  clearFaviconCache,
  filterItems,
  getItemActions,
  groupByFolder,
  itemIcon,
  itemSubtitle,
  itemTypeLabel,
  loadCachedVault,
  loadFaviconCache,
  resolveFavicons,
  saveCachedVault,
} from "./item-utils";
import { useSession } from "./use-session";
import type { BwFolder, BwItem } from "./bitwarden-types";
import { ItemType } from "./bitwarden-types";

type UIState =
  | { kind: "checking-bw" }
  | { kind: "bw-not-installed" }
  | { kind: "logging-in" }
  | { kind: "needs-unlock"; error?: string }
  | { kind: "unlocking" }
  | { kind: "loading" }
  | { kind: "vault"; items: BwItem[]; folders: BwFolder[] };

// Module-level cache for instant synchronous initial render
let memoryVault: { items: BwItem[]; folders: BwFolder[] } | null = null;

export default function SearchVault() {
  const { session, unlock, clearSession, loginIfNeeded, isLoggingIn, loginError } =
    useSession();
  const [state, setState] = useState<UIState>(() => {
    if (memoryVault) {
      return { kind: "vault", items: memoryVault.items, folders: memoryVault.folders };
    }
    return { kind: "checking-bw" };
  });

  const setVault = (items: BwItem[], folders: BwFolder[]) => {
    memoryVault = { items, folders };
    setState({ kind: "vault", items, folders });
  };

  const syncVault = async (token: string) => {
    await bw.sync(token);
    const [items, folders] = await Promise.all([
      bw.listItems(token),
      bw.listFolders(token),
    ]);
    await saveCachedVault(items, folders);
    setVault(items, folders);
    clearFaviconCache();
    setFaviconMap({});
  };
  const [searchText, setSearchText] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [faviconMap, setFaviconMap] = useState<Record<string, string>>({});
  const { push } = useNavigation();

  // Step 1: Load cached vault immediately, run bw checks in parallel
  useEffect(() => {
    void (async () => {
      const map = await loadFaviconCache();
      setFaviconMap(map);

      const cached = await loadCachedVault();
      if (cached) {
        setVault(cached.items, cached.folders);
      }

      // Check bw in background
      const installed = await bw.checkInstalled();
      if (!installed) {
        setState({ kind: "bw-not-installed" });
        return;
      }

      try {
        const st = await bw.status();
        if (st.status === "unauthenticated") {
          setState({ kind: "logging-in" });
          return;
        }
      } catch {
        // If status fails, proceed — session check will handle it
      }

      if (!session) {
        if (!cached) setState({ kind: "needs-unlock" });
        return;
      }

      // Sync in background (cache already shown above)
      try {
        await syncVault(session);
      } catch {
        if (!cached) {
          await clearSession();
          setState({ kind: "needs-unlock", error: "Session expired" });
        }
      }
        if (!cached) {
          await clearSession();
          setState({ kind: "needs-unlock", error: "Session expired" });
        }
      }
    })();
  }, []);

  // Step 1b: when session resolves after mount, try loading
  useEffect(() => {
    if (!session) return;
    if (state.kind !== "needs-unlock") return;

    setState({ kind: "loading" });
  }, [session, state.kind]);

  // Step 1c: when session appears while vault is already showing (cache loaded first)
  useEffect(() => {
    if (!session) return;
    if (state.kind !== "vault") return;

    void (async () => {
      try {
        await syncVault(session);
      } catch {
        // Cache already showing — silent fail
      }
    })();
  }, [session]);

  // Resolve favicons after vault appears (catches both cached and fresh loads)
  useEffect(() => {
    if (state.kind !== "vault") return;

    const domains: string[] = [];
    for (const item of state.items) {
      if (item.type === ItemType.Login && item.login?.uris?.[0]?.uri) {
        try {
          domains.push(new URL(item.login.uris[0].uri).hostname);
        } catch {
          // skip
        }
      }
    }

    if (domains.length === 0) return;

    void (async () => {
      const map = await resolveFavicons(domains);
      setFaviconMap(map);
    })();
  }, [state]);

  // Step 2: When state becomes "loading" and session is available, load vault
  useEffect(() => {
    if (!session) return;
    if (state.kind !== "loading") return;

    void (async () => {
      const cached = await loadCachedVault();
      if (cached) {
        setVault(cached.items, cached.folders);
      }

      try {
        await syncVault(session);
      } catch (err) {
        if (!cached) {
          const message = err instanceof Error ? err.message : String(err);
          await showToast({ style: Toast.Style.Failure, title: "Failed to load vault", message });
          await clearSession();
          setState({ kind: "needs-unlock", error: message });
        }
      }
    })();
  }, [session, state.kind]);

  // Step 2: When login is needed, attempt login
  useEffect(() => {
    if (state.kind !== "logging-in") return;
    void (async () => {
      try {
        await loginIfNeeded();
        setState({ kind: "needs-unlock" });
      } catch {
        await showToast({
          style: Toast.Style.Failure,
          title: "Login failed",
          message: loginError ?? "Check your API key in preferences",
        });
        setState({
          kind: "needs-unlock",
          error: loginError ?? "Login failed — check preferences",
        });
      }
    })();
  }, [state.kind]);

  // Sync handler
  const handleSync = useCallback(async () => {
    if (!session) return;
    setIsSyncing(true);
    try {
      await syncVault(session);
      await showToast({ style: Toast.Style.Success, title: "Vault synced" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await showToast({
        style: Toast.Style.Failure,
        title: "Sync failed",
        message,
      });
    } finally {
      setIsSyncing(false);
    }
  }, [session]);

  // Lock handler
  const handleLock = useCallback(async () => {
    await clearSession();
    await clearCachedVault();
    setState({ kind: "needs-unlock" });
  }, [clearSession]);

  // Unlock handler
  const handleUnlock = useCallback(
    async (values: Form.Values) => {
      setState({ kind: "unlocking" });
      try {
        const password = String(values.password ?? "");
        await unlock(password);
        setState({ kind: "loading" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "needs-unlock", error: message });
      }
    },
    [unlock],
  );

  // --- Derived data (must be unconditional — hooks rules) ---
  const vaultItems = state.kind === "vault" ? state.items : [];
  const vaultFolders = state.kind === "vault" ? state.folders : [];

  const filtered = useMemo(
    () => filterItems(vaultItems, searchText),
    [vaultItems, searchText],
  );
  const grouped = useMemo(
    () => groupByFolder(filtered, vaultFolders),
    [filtered, vaultFolders],
  );

  const handleCopyTotp = useCallback(
    async (id: string) => {
      if (!session) return;
      try {
        const totp = await bw.getTotp(id, session);
        await Clipboard.copy(totp);
        await showToast({ style: Toast.Style.Success, title: "Copied TOTP" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to get TOTP",
          message,
        });
      }
    },
    [session],
  );

  // --- Render based on state ---

  // bw-not-installed and unlock states use their own container (no search handler)
  if (state.kind === "bw-not-installed") {
    return <BwNotInstalled />;
  }

  if (state.kind === "needs-unlock" || state.kind === "unlocking") {
    return (
      <Form
        isLoading={state.kind === "unlocking"}
        actions={
          <ActionPanel>
            <Action.SubmitForm title="Unlock" onSubmit={handleUnlock} />
          </ActionPanel>
        }
      >
        <Form.PasswordField
          id="password"
          title="Master Password"
          error={state.kind === "needs-unlock" ? state.error : undefined}
        />
      </Form>
    );
  }

  // All vault states share a single persistent List to keep handler IDs stable
  const isLoading =
    state.kind === "checking-bw" ||
    state.kind === "logging-in" ||
    state.kind === "loading" ||
    isSyncing;

  const sortedSections = [...grouped.entries()].sort(([, a], [, b]) =>
    a.folderName.localeCompare(b.folderName),
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search vault by name..."
      throttle
    >
      {state.kind === "vault" ? (
        sortedSections.length === 0 ? (
          <List.EmptyView
            title={searchText ? "No matching items" : "No items in vault"}
            description={
              searchText
                ? "Try a different search or Sync to refresh your vault"
                : "Sync to pull your vault data, or create an item"
            }
          />
        ) : (
          sortedSections.map(([folderId, { folderName, items: sectionItems }]) => (
            <List.Section key={folderId ?? "unfiled"} title={folderName}>
              {sectionItems.map((item) => (
                <List.Item
                  key={item.id}
                  icon={itemIcon(item, faviconMap)}
                  title={item.name}
                  subtitle={itemSubtitle(item)}
                  accessories={[{ text: itemTypeLabel(item) }]}
                  actions={
                    <ActionPanel>
                      {renderItemActions(item, session, handleCopyTotp, push, vaultFolders)}
                      <Action
                        title="Sync Vault"
                        icon={Icon.ArrowClockwise}
                        onAction={handleSync}
                      />
                      <Action
                        title="Lock Vault"
                        icon={Icon.Lock}
                        style={Action.Style.Destructive}
                        onAction={handleLock}
                      />
                    </ActionPanel>
                  }
                />
              ))}
            </List.Section>
          ))
        )
      ) : (
        <List.EmptyView title="Loading..." />
      )}
    </List>
  );
}

function renderItemActions(
  item: BwItem,
  session: bw.Session | null,
  onCopyTotp: (id: string) => Promise<void>,
  push: ReturnType<typeof useNavigation>["push"],
  folders: BwFolder[],
) {
  const actions = getItemActions(item);
  const folderName = item.folderId
    ? (folders.find((f) => f.id === item.folderId)?.name ?? item.folderId)
    : undefined;

  return (
    <>
      <Action
        title="View Details"
        icon={Icon.Eye}
        onAction={() => {
          push(
            <ItemDetailView
              item={item}
              session={session}
              onCopyTotp={onCopyTotp}
              folderName={folderName}
            />,
          );
        }}
      />
      {actions.map((action) => {
        if (action.label === "Copy TOTP") {
          return (
            <Action
              key={action.label}
              title={action.label}
              icon={Icon.CopyClipboard}
              onAction={() => onCopyTotp(item.id)}
            />
          );
        }
        if (action.label === "Open URL") {
          return (
            <Action.OpenInBrowser
              key={action.label}
              title={action.label}
              icon={Icon.Globe01}
              url={action.value}
            />
          );
        }
        return (
          <Action.CopyToClipboard
            key={action.label}
            title={action.label}
            content={action.value}
          />
        );
      })}
    </>
  );
}

function buildMetadata(
  item: BwItem,
  folderName: string | undefined,
  showPassword: boolean,
  totpCode?: string,
) {
  return (
    <Detail.Metadata>
      <Detail.Metadata.Label title="Type" text={itemTypeLabel(item)} />
      {folderName && <Detail.Metadata.Label title="Folder" text={folderName} />}

      {item.type === ItemType.Login && item.login && (
        <>
          <Detail.Metadata.Separator />
          {item.login.username && (
            <Detail.Metadata.Label title="Username" text={item.login.username} />
          )}
          {item.login.password && (
            <Detail.Metadata.Label
              title="Password"
              text={showPassword ? item.login.password : "••••••••••••"}
            />
          )}
          {item.login.totp && (
            <Detail.Metadata.Label
              title="TOTP"
              text={totpCode ?? "Loading..."}
            />
          )}
          {item.login.uris && item.login.uris.length > 0 && (
            <Detail.Metadata.Label
              title="URL"
              text={item.login.uris.map((u) => u.uri).join(", ")}
            />
          )}
        </>
      )}

      {item.type === ItemType.Card && item.card && (
        <>
          <Detail.Metadata.Separator />
          {item.card.cardholderName && (
            <Detail.Metadata.Label title="Cardholder" text={item.card.cardholderName} />
          )}
          {item.card.brand && (
            <Detail.Metadata.Label title="Brand" text={item.card.brand} />
          )}
          {item.card.number && (
            <Detail.Metadata.Label
              title="Number"
              text={`•••• ${item.card.number.slice(-4)}`}
            />
          )}
          {item.card.expMonth && item.card.expYear && (
            <Detail.Metadata.Label
              title="Expires"
              text={`${item.card.expMonth}/${item.card.expYear}`}
            />
          )}
          {item.card.code && (
            <Detail.Metadata.Label title="Code" text="•••" />
          )}
        </>
      )}

      {item.type === ItemType.Identity && item.identity && (
        <>
          <Detail.Metadata.Separator />
          {item.identity.title && (
            <Detail.Metadata.Label title="Title" text={item.identity.title} />
          )}
          {item.identity.firstName && (
            <Detail.Metadata.Label title="First Name" text={item.identity.firstName} />
          )}
          {item.identity.lastName && (
            <Detail.Metadata.Label title="Last Name" text={item.identity.lastName} />
          )}
          {item.identity.email && (
            <Detail.Metadata.Label title="Email" text={item.identity.email} />
          )}
          {item.identity.phone && (
            <Detail.Metadata.Label title="Phone" text={item.identity.phone} />
          )}
          {(item.identity.address1 || item.identity.city) && (
            <>
              <Detail.Metadata.Separator />
              {item.identity.address1 && (
                <Detail.Metadata.Label title="Address" text={item.identity.address1} />
              )}
              {item.identity.city && (
                <Detail.Metadata.Label title="City" text={item.identity.city} />
              )}
              {item.identity.state && (
                <Detail.Metadata.Label title="State" text={item.identity.state} />
              )}
              {item.identity.postalCode && (
                <Detail.Metadata.Label title="Postal Code" text={item.identity.postalCode} />
              )}
              {item.identity.country && (
                <Detail.Metadata.Label title="Country" text={item.identity.country} />
              )}
            </>
          )}
        </>
      )}
    </Detail.Metadata>
  );
}

function actionIcon(action: { label: string }): Image.ImageLike | undefined {
  switch (action.label) {
    case "Copy Password":
      return Icon.Key;
    case "Copy Username":
      return Icon.Person;
    case "Copy Card Number":
      return Icon.CreditCard;
    case "Copy Security Code":
      return Icon.Lock;
    case "Copy Name":
      return Icon.Person;
    case "Copy Email":
      return Icon.Envelope;
    case "Copy Phone":
      return Icon.Phone;
    default:
      return undefined;
  }
}

function ItemDetailView({
  item,
  session,
  onCopyTotp,
  folderName,
}: {
  item: BwItem;
  session: bw.Session | null;
  onCopyTotp: (id: string) => Promise<void>;
  folderName?: string;
}) {
  const [fullItem, setFullItem] = useState<BwItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [totpCode, setTotpCode] = useState<string | undefined>();
  const { pop } = useNavigation();

  useEffect(() => {
    if (!session) return;
    void (async () => {
      try {
        const fetched = await bw.getItem(item.id, session);
        setFullItem(fetched);
      } catch {
        setFullItem(item);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [item.id, session]);

  // Fetch TOTP code and refresh every 30s
  useEffect(() => {
    if (!session) return;
    const resolved = fullItem ?? item;
    if (resolved.type !== ItemType.Login || !resolved.login?.totp) return;

    let active = true;

    const fetch = async () => {
      try {
        const code = await bw.getTotp(item.id, session);
        if (active) setTotpCode(code);
      } catch {
        if (active) setTotpCode(undefined);
      }
    };

    fetch();
    const interval = setInterval(fetch, 30_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [session, fullItem]);

  const resolved = fullItem ?? item;
  const markdown = buildItemDetailMarkdown(resolved);
  const actions = getItemActions(resolved);
  const resolvedFolderName = folderName ?? resolved.folderId ?? undefined;

  const metadata = buildMetadata(resolved, resolvedFolderName, true, totpCode);

  const handleDelete = useCallback(async () => {
    if (!session) return;
    const confirmed = await confirmAlert({
      title: "Delete Item",
      message: `Are you sure you want to delete "${resolved.name}"?`,
      primaryAction: {
        title: "Delete",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;

    try {
      await bw.deleteItem(item.id, session);
      await showToast({ style: Toast.Style.Success, title: "Item deleted" });
      pop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await showToast({ style: Toast.Style.Failure, title: "Delete failed", message });
    }
  }, [item.id, session, pop, resolved.name]);

  return (
    <Detail
      markdown={isLoading ? "Loading..." : markdown}
      navigationTitle={resolved.name}
      metadata={metadata}
      actions={
        <ActionPanel>
          {actions.map((action) => {
            if (action.label === "Copy TOTP") {
              return (
                <Action
                  key={action.label}
                  title={action.label}
                  icon={Icon.CopyClipboard}
                  onAction={() => onCopyTotp(item.id)}
                />
              );
            }
            if (action.label === "Open URL") {
              return (
                <Action.OpenInBrowser
                  key={action.label}
                  title={action.label}
                  icon={Icon.Globe01}
                  url={action.value}
                />
              );
            }
            return (
              <Action.CopyToClipboard
                key={action.label}
                title={action.label}
                icon={actionIcon(action)}
                content={action.value}
              />
            );
          })}
          <Action
            title="Delete Item"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={handleDelete}
          />
        </ActionPanel>
      }
    />
  );
}
