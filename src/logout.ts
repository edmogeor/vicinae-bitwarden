import { LocalStorage, showToast, Toast } from "@vicinae/api";
import * as bw from "./bw-executor";
import { SESSION_KEY } from "./use-session";

export default async function Logout() {
  try {
    await bw.logout();
    await LocalStorage.removeItem(SESSION_KEY);
    await showToast({
      style: Toast.Style.Success,
      title: "Logged out",
      message: "Your Bitwarden session has been cleared",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await showToast({
      style: Toast.Style.Failure,
      title: "Logout failed",
      message,
    });
  }
}
