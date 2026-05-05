import { showToast, Toast } from '@vicinae/api';
import * as bw from './bw-executor';
import { getErrorMessage } from './bw-executor';
import { deleteSession } from './session-store';

export default async function Logout() {
  try {
    await bw.logout();
    await deleteSession();
    await showToast({
      style: Toast.Style.Success,
      title: 'Logged out',
      message: 'Your Bitwarden session has been cleared',
    });
  } catch (err) {
    const message = getErrorMessage(err);
    await showToast({
      style: Toast.Style.Failure,
      title: 'Logout failed',
      message,
    });
  }
}
