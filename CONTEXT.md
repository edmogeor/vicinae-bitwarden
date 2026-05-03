# Vicinae-Warden

A Vicinae extension that provides keyboard-driven access to a Bitwarden vault. Users unlock once with their master password, then search and copy passwords, usernames, and TOTP codes directly from the launcher. Items can also be created without leaving Vicinae.

## Language

### Vault & Access

**Vault**:
The encrypted store of a user's Bitwarden items. Always a single personal vault in scope; organization vaults are out of scope for v1.
_Avoid_: Password store, locker

**Item**:
A single entry in the Vault — one of four types: Login, Card, Identity, or Secure Note.
_Avoid_: Entry, record, credential

**Session**:
A decryption token returned by `bw unlock`, valid for one vault timeout period. Cached in LocalStorage so the user doesn't re-enter their master password on every Vicinae restart.
_Avoid_: Token, key, login state

**Unlock**:
The act of entering the master password to derive a Session. Distinct from Login (which establishes the account-to-server relationship via API key).
_Avoid_: Decrypt, authenticate

**Login**:
Establishes the Bitwarden account on a Server using an API key (client_id + client_secret). Performed once; different from Unlock.
_Avoid_: Sign in, authenticate

**Server**:
The Bitwarden instance the vault lives on. Either a cloud region (`bitwarden.com`, `bitwarden.eu`) or a self-hosted domain.
_Avoid_: Instance, endpoint

**API Key**:
A `client_id` and `client_secret` pair generated from the Bitwarden web vault. Used to Login the CLI. Stored as extension preferences.
_Avoid_: Credentials, api token

### Organization

**Folder**:
An organizational grouping of Items within the Vault. Rendered as `List.Section` in the search view.
_Avoid_: Collection (that's an organization concept), category, group

### Operations

**Sync**:
Pulling the latest vault state from the Server into the local CLI cache. Runs automatically after Unlock and on manual request.
_Avoid_: Refresh, update, fetch

**Search**:
Client-side, name-only filtering of the fetched item list. Matching is case-insensitive substring against each item's name.
_Avoid_: Query, filter, find

### CLI

**`bw`**:
The Bitwarden CLI binary. A hard prerequisite — the extension shells out to it for all vault operations. Must be on PATH.
_Avoid_: Bitwarden CLI, bw command

## Relationships

- A **Vault** contains many **Items**
- An **Item** belongs to zero or one **Folders**
- A **Server** hosts one **Vault**
- An **API Key** establishes a **Login** to a **Server**
- A **Login** must happen once before any **Unlock**
- An **Unlock** produces a **Session**
- A **Session** is required for all **Search** / **Sync** / create operations
- A **Sync** pulls the latest Vault state and must be completed before **Search** can return accurate results

## Example dialogue

> **Dev:** "When does the user need to enter their master password?"
> **Domain expert:** "Every time a Session expires or is missing. The extension checks LocalStorage first — if a cached Session is still valid, the vault list appears immediately. If not, it shows the Unlock form."
>
> **Dev:** "And when does Login happen?"
> **Domain expert:** "On first use, after the user fills in the API key preferences. The extension runs `bw login --apikey` targeting the configured Server. After that, only Unlock is needed."
>
> **Dev:** "What happens if the user searches for 'bank' but nothing matches?"
> **Domain expert:** "An empty view with a message. Their Items are still there — the Search just didn't match any names. They can clear the query or Sync to make sure data is fresh."

## Flagged ambiguities

- "Login" was used to mean both the Bitwarden account auth step AND the vault item type. Resolved: **Login** (capitalized) is the account auth step; a **Login item** is a vault item of type Login.
- "Organization" initially arose but was scoped out — personal vault only for v1.
