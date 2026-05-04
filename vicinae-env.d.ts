/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** Server Region - The Bitwarden instance your vault lives on */
	"serverRegion"?: "bitwarden.com" | "bitwarden.eu" | "self-hosted";

	/** Custom Server URL - Required when Server Region is set to Self-hosted. Example: https://vault.example.com */
	"customServerUrl": string;

	/** API Client ID - Your personal API key client_id from the Bitwarden web vault (Settings → Security → View API key) */
	"apiClientId"?: string;

	/** API Client Secret - Your personal API key client_secret from the Bitwarden web vault */
	"apiClientSecret"?: string;

	/** Password Length - Number of characters for generated passwords */
	"passwordLength": string;

	/** Include Uppercase (A-Z) - Add uppercase letters to generated passwords */
	"passwordUppercase": boolean;

	/** Include Lowercase (a-z) - Add lowercase letters to generated passwords */
	"passwordLowercase": boolean;

	/** Include Numbers (0-9) - Add digits to generated passwords */
	"passwordNumbers": boolean;

	/** Include Symbols (!@#$) - Add special characters to generated passwords */
	"passwordSymbols": boolean;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Search Vault */
	export type SearchVault = ExtensionPreferences & {
		
	}

	/** Command: Create Item */
	export type CreateItem = ExtensionPreferences & {
		
	}

	/** Command: Log Out */
	export type Logout = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Search Vault */
	export type SearchVault = {
		
	}

	/** Command: Create Item */
	export type CreateItem = {
		
	}

	/** Command: Log Out */
	export type Logout = {
		
	}
}