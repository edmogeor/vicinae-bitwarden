# Support

Thanks for using the Bitwarden extension for Vicinae. This page describes how to get help and, in particular, how to collect the information we need to diagnose a bug.

## Before opening an issue

1. Search [existing issues](https://github.com/edmogeor/vicinae-bitwarden/issues?q=is%3Aissue) — your problem may already be tracked.
2. Update to the latest version of the extension and the Bitwarden CLI (`bw --version`).
3. Restart Vicinae and re-check:

   ```bash
   pkill vicinae && systemctl --user restart vicinae
   ```

4. If the bug looks like stale state (missing items after a vault change, wrong TOTP, ghost entries from another account), run the extension's **Log Out** command. It wipes the local cache and clears the libsecret entries the extension owns (session, TOTP secrets, Send keys). Then sign back in and retry.

If the problem is in **Vicinae itself**, report it at [vicinaehq/vicinae](https://github.com/vicinaehq/vicinae/issues). If the problem is in the **Bitwarden CLI** (`bw`), report it at [bitwarden/clients](https://github.com/bitwarden/clients).

## Collecting logs

A good bug report almost always includes logs. There are two ways to grab them — please include at least one when filing a bug.

### Option A — Copy from the in-app error screen

When the extension hits a fatal error, it shows a `VaultError` screen instead of an empty list. From that screen:

1. Open the action panel (`⌘K` / `Ctrl+K`).
2. Run **Copy Error**.
3. Paste the result into your bug report.

The error details are redacted by the extension before being shown, so master passwords, session keys, vault contents, and attachment paths are scrubbed. Skim the output before posting anyway.

### Option B — Tail the stderr log while reproducing

For non-fatal issues (slow searches, missing TOTP codes, UI glitches), the in-app screen won't trigger. Use the stderr log instead:

1. Open a terminal and run:

   ```bash
   tail -F ~/.local/share/vicinae/support/bitwarden/.vicinae/stderr.txt
   ```

2. Leave it running.
3. Switch to Vicinae and reproduce the issue.
4. Copy the new lines that appeared in the terminal.
5. Paste them into your bug report.

The extension redacts secrets before logging, but always skim the output and remove anything you'd rather not share (URLs, usernames, file paths to attachments, etc.).

## What to include in a bug report

Use the [Bug report](https://github.com/edmogeor/vicinae-bitwarden/issues/new?template=bug_report.yml) template. At minimum:

- A short summary of what went wrong.
- Numbered steps to reproduce.
- Expected vs. actual behavior.
- Versions: extension, Vicinae, `bw --version`.
- Server region (Bitwarden.com / EU / self-hosted URL — no credentials).
- Operating system.
- Logs from Option A or Option B above.

## What **not** to include

- Master password, session key, or two-step login codes.
- Vault items, attachment contents, or Send contents.
- Full self-hosted URLs with embedded credentials.

If you're unsure whether a snippet is safe to share, redact it.
