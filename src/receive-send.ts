import { Clipboard, closeMainWindow, showHUD, showToast, Toast } from '@vicinae/api';
import * as bw from './bw-executor';
import { getErrorMessage } from './bw-executor';
import { getDownloadDir, getPreferences } from './preferences';

export default async function ReceiveSend() {
  let url = '';
  try {
    url = (await Clipboard.readText()).trim();
  } catch {
    await showHUD('No Send URL in clipboard');
    return;
  }

  if (!url) {
    await showHUD('No Send URL in clipboard');
    return;
  }

  try {
    const result = await bw.receiveSend(url);

    if (result.kind === 'text' && result.text) {
      await Clipboard.copy(result.text);
      const preview = result.text.length > 100 ? `${result.text.slice(0, 100)}…` : result.text;
      await closeMainWindow();
      await showHUD(`Send text copied: ${preview}`);
      return;
    }
  } catch (textErr) {
    if (isPasswordError(textErr)) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Send is password-protected',
        message: 'Use the CLI directly: bw send receive <url> --password <password>',
      });
      return;
    }
    if (isEmailVerificationError(textErr)) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Email verification required',
        message:
          'This Send requires email verification, which is a premium feature not supported here.',
      });
      return;
    }
    // Text receive failed, try file receive
  }

  try {
    let downloadDir: string;
    try {
      const prefs = getPreferences();
      downloadDir = getDownloadDir(prefs);
    } catch {
      downloadDir = `${process.env.HOME ?? '/tmp'}/Downloads`;
    }

    const result = await bw.receiveSend(url, undefined, downloadDir);

    if (result.kind === 'file' && result.path) {
      await closeMainWindow();
      await showHUD(`File saved: ${result.path}`);
      return;
    }
  } catch (fileErr) {
    if (isPasswordError(fileErr)) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Send is password-protected',
        message: 'Use the CLI directly: bw send receive <url> --password <password>',
      });
      return;
    }
    if (isEmailVerificationError(fileErr)) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Email verification required',
        message:
          'This Send requires email verification, which is a premium feature not supported here.',
      });
      return;
    }
    const message = getErrorMessage(fileErr);
    await showToast({
      style: Toast.Style.Failure,
      title: 'Failed to receive send',
      message,
    });
  }
}

function isPasswordError(err: unknown): boolean {
  const message = getErrorMessage(err).toLowerCase();
  return (
    message.includes('password') &&
    (message.includes('required') || message.includes('protected') || message.includes('incorrect'))
  );
}

function isEmailVerificationError(err: unknown): boolean {
  const message = getErrorMessage(err).toLowerCase();
  return (
    message.includes('email') && (message.includes('verification') || message.includes('verify'))
  );
}
