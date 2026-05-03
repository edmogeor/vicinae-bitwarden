import { getPreferenceValues } from "@vicinae/api";

export interface Preferences {
  serverRegion: "bitwarden.com" | "bitwarden.eu" | "self-hosted";
  customServerUrl: string;
  apiClientId: string;
  apiClientSecret: string;
}

export function getPreferences(): Preferences {
  return getPreferenceValues<Preferences>();
}

export function getServerUrl(prefs: Preferences): string {
  if (prefs.serverRegion === "self-hosted") {
    const url = prefs.customServerUrl.trim();
    if (!url) {
      throw new Error(
        "Custom Server URL is required when using Self-hosted. Set it in extension preferences.",
      );
    }
    return url.replace(/\/+$/, "");
  }
  return `https://${prefs.serverRegion}`;
}
