import { LocalStorage, showToast, Toast } from "@vicinae/api";
import * as bw from "./bw-executor";

export default async function Logout() {
  try {
    await bw.logout();
    await LocalStorage.removeItem("vicinae-bitwarden-session");
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
