# PRD: Vicinae-Warden

## Problem Statement

Users of the Vicinae launcher who use Bitwarden as their password manager must switch contexts — open a browser extension, desktop app, or terminal — to find and copy passwords, usernames, and TOTP codes. This breaks the keyboard-driven workflow that Vicinae is designed to provide. Self-hosted Bitwarden users have the same friction but also need to configure a custom server URL, which most tools don't handle cleanly.

## Solution

A Vicinae extension that puts the Bitwarden vault directly into the launcher. The user configures their API key and server (cloud or self-hosted) once as preferences, then unlocks with their master password. From there, they can search all vault items by name, copy credentials with a keystroke, and create new items — all without leaving the launcher. The Session persists across Vicinae restarts via LocalStorage.

## User Stories

1. As a Vicinae user, I want to install an extension from the store that connects to my Bitwarden vault, so that I don't need to run a separate command to set up basic plumbing.
2. As a self-hosted Bitwarden user, I want to configure my custom server URL, so that the extension targets my own instance rather than the cloud.
3. As a cloud Bitwarden user, I want to select my region (US or EU) from a dropdown, so that I don't have to memorize or paste endpoint URLs.
4. As a Bitwarden user, I want to provide my personal API key once as a preference, so that the extension can establish the Login to my Server without storing my master password.
5. As a user who has configured their API key, I want the extension to run a one-time `bw login --apikey`, so that my Bitwarden account is established and I only need to Unlock after that.
6. As a user whose Bitwarden CLI is not installed, I want to see a clear message on first run telling me to install `bw` and linking to the download page, so that I don't encounter obscure shell errors.
7. As a user who has a valid cached Session, I want the vault list to appear immediately when I open the extension, so that I don't re-enter my master password unnecessarily.
8. As a user whose Session has expired or doesn't exist, I want to see an Unlock form prompting for my master password, so that I can establish a new Session.
9. As a user entering my master password, I want the input field to be masked and the password not echoed anywhere, so that my credentials are not exposed.
10. As a user who just unlocked, I want the extension to automatically Sync my vault, so that I see the latest items from the Server.
11. As a user browsing my vault, I want to see Items grouped by Folder as sections in the list, so that I can visually navigate by organizational structure.
12. As a user searching my vault, I want to filter Items by typing a name substring (case-insensitive), so that I can quickly find what I need without scrolling.
13. As a user searching for an Item that doesn't exist by name, I want to see an empty view with a helpful message, so that I know nothing matched rather than wondering if the extension is broken.
14. As a user viewing a Login item, I want actions to copy the password, copy the username, and copy the TOTP code (if present), so that I can fill credentials into whatever app I'm switching to.
15. As a user viewing a Login item, I want an action to open the associated URL in my browser, so that I can navigate to the site directly.
16. As a user viewing a Login item, I want to push a Detail view showing all fields (name, username, password masked, URLs, notes, TOTP, custom fields), so that I can inspect the full item before acting.
17. As a user viewing a Card item, I want actions to copy the card number and security code, so that I can paste them into a checkout form.
18. As a user viewing an Identity item, I want actions to copy the name, email, and phone number, so that I can paste personal details into forms.
19. As a user viewing a Secure Note item, I want an action to view the full note text in a Detail view, so that I can read its contents.
20. As a user who suspects my vault is out of date, I want a manual "Sync Now" action in the vault list, so that I can force a Sync on demand.
21. As a user who wants to create a new Login item, I want to run a separate command that shows a Form with type dropdown set to Login, fields for name/username/password/URL/notes/TOTP, so that I can add credentials on the fly.
22. As a user who wants to create a new Card item, I want to select "Card" from the type dropdown and see relevant fields (cardholder, number, brand, expiration, code), so that I can store payment details.
23. As a user who wants to create a new Identity item, I want to select "Identity" and see identity fields (title, first/last names, email, phone, address), so that I can store personal profile data.
24. As a user who wants to create a new Secure Note, I want to select "Secure Note" and see a name field plus a notes text area, so that I can save arbitrary text.
25. As a user who created an item successfully, I want to see a success toast and be navigated back, so that I know the creation worked.
26. As a user who encounters an error (invalid password, network failure, CLI crash), I want to see a failure toast with a human-readable message, so that I understand what went wrong.
27. As a user who wants to lock the vault manually, I want a "Lock" action that clears the cached Session, so that subsequent command opens force Unlock.

## Implementation Decisions

### Architecture

The extension shells out to the `bw` CLI binary via Node `child_process.execFile`. There is no direct HTTP integration or background server — every operation is a one-shot CLI invocation. The `bw` binary must be on the user's PATH.

### Modules

**`bw-executor`** (deep module) — Encapsulates all CLI interaction behind typed async functions. Functions: `checkInstalled`, `login`, `unlock`, `sync`, `listItems`, `getItem`, `createItem`. Each returns a typed result or throws an `BwError` with a structured message. Tests should mock `child_process.execFile` and verify that the correct CLI arguments are assembled and output parsed.

**`use-session`** (deep module) — React hook managing the Session lifecycle. Reads from LocalStorage on mount, exposes `{ session, unlock(password), clearSession, loginIfNeeded() }`. `session` is `null` when no valid Session exists. The hook encapsulates all LocalStorage key management and Session format. Tests should verify LocalStorage read/write behavior.

**`item-utils`** (deep module) — Pure functions for transforming Bitwarden item JSON into display shapes. `filterItems(items, query)` returns items whose name contains the query string (case-insensitive). `groupByFolder(items)` returns `Map<folderId, Item[]>` with a `null` key for unfiled items. `itemActions(item)` returns an array of action descriptors (`{ label, value, icon? }`) appropriate for the item's type. `toCreatePayload(formValues, type)` serializes a Vicinae Form submission into the JSON structure `bw create` expects. Tests are pure input/output assertions.

**`preferences`** (shallow module) — Typed wrapper around `getPreferenceValues()`. Exports a `Preferences` interface and a `getPreferences()` function that validates the server URL for self-hosted cases.

### Commands

Two commands in the manifest, both `mode: "view"`:

- **`search-vault`** — Orchestrates unlock gate + vault list. On mount, checks Session via `use-session`. If no Session, renders the Unlock Form (a `<Form>` with a single `Form.PasswordField`). On unlock, calls `bw sync` then `bw list items`. Renders `<List>` with `List.Section` per folder. Each `<List.Item>` shows name, type badge, and username/subtitle. `<ActionPanel>` actions vary by item type. Includes a "Sync Now" action and a "Lock Vault" action in the search bar.

- **`create-item`** — Orchestrates unlock gate + creation form. Same unlock gate pattern. On unlock, renders a `<Form>` with a `Form.Dropdown` for type (Login/Card/Identity/Secure Note). Conditional fields appear based on type selection. Submit serializes via `toCreatePayload` and calls `bw create item`. On success, shows toast and pops the view.

### Preferences schema

Four extension-level preferences in the manifest:

- `serverRegion` — dropdown: `bitwarden.com`, `bitwarden.eu`, `self-hosted`
- `customServerUrl` — textfield, only required when `serverRegion` is `self-hosted`
- `apiClientId` — textfield, required
- `apiClientSecret` — password field, required

### Session caching

The Session token is stored in LocalStorage under a documented key. On every command mount, the Session is read and validated by attempting a lightweight `bw` command (e.g., `bw status`). If the command fails, the Session is discarded and the unlock form is shown.

### Error handling

All errors surface to the user via `showToast({ style: Toast.Style.Failure })`. Three categories:

- **Pre-requisite errors**: `bw` not on PATH → show install guide Detail view
- **Auth errors**: invalid master password, expired session → show unlock form with error
- **Operational errors**: network failure, `bw` crash, malformed output → failure toast with message

### Item type handling

Each of the four Bitwarden item types (Login, Card, Identity, Secure Note) gets:

- A distinct set of copy actions in the vault list's `<ActionPanel>`
- A distinct set of fields in the create Form
- A type-specific Detail view with appropriate metadata

### Search behavior

Search is client-side, name-only, case-insensitive substring matching. Filtering happens on every keystroke (throttled via `List.throttle`). The complete item list is fetched once after unlock + sync and held in React state.

### Folder rendering

Items without a folder are grouped under an "Unfiled" section. Items with a folder are grouped under that folder's name. The section title is the folder name. Sort order matches the order `bw` returns.

## Testing Decisions

Tests should focus on external behavior, not implementation details. Good tests verify that given an input, the module produces the expected output or side effect.

### Modules to test

- **`bw-executor`** — Mock `child_process.execFile`. Verify correct CLI args for each operation, correct parsing of JSON stdout, correct error wrapping on non-zero exit codes. Do not test against a real `bw` binary.
- **`item-utils`** — Pure function tests. Given representative Bitwarden item JSON fixtures, verify filtering, grouping, action generation, and serialization. No mocking needed.
- **`use-session`** — Mock `LocalStorage` and `bw-executor` functions. Verify that Session is read from storage on mount, stored after unlock, cleared on lock, and that invalid sessions trigger unlock.

### Modules not tested

- **View commands** (`search-vault`, `create-item`) — React components tested implicitly by `vici lint` and manual smoke testing. The deep logic is tested in the modules above.
- **`preferences`** — Thin wrapper around Vicinae API, tested implicitly by `vici lint`.

## Out of Scope

- Organization (shared) vaults
- Bitwarden Send
- File attachments
- Password/passphrase generation
- Vault health reports
- Master password changes or account settings
- Favorites or pinned items
- Bulk operations (export, import)
- Browser autofill integration
- TOTP code auto-refresh in the list (TOTP is copy-only)
- Rich icons or favicon fetching for items
- Multiple Bitwarden accounts

## Further Notes

- The extension name `vicinae-warden` combines Vicinae with the concept of a "warden" (a guardian or keeper) — referencing the Bitwarden name while signaling its role as a vault keeper within the launcher.
- The `bw` CLI must be installed separately. The Bitwarden CLI installer is available at https://bitwarden.com/download/ for all major Linux distributions (AppImage, Snap, npm).
- The personal API key is generated from the Bitwarden web vault under Settings → Security → View API key. It is distinct from the organization API key used by the Public API.
- The Session produced by `bw unlock` inherits the vault timeout settings configured in the user's Bitwarden account. If the vault is set to lock after 15 minutes, the cached Session becomes invalid after 15 minutes.
