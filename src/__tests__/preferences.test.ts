import { describe, expect, it, vi } from 'vitest';

vi.mock('@vicinae/api', () => ({
  getPreferenceValues: vi.fn(),
  LocalStorage: {},
}));

import { getServerUrl, getAutoLockSeconds } from '../preferences';

function prefs(
  overrides: Partial<{
    serverRegion: 'bitwarden.com' | 'bitwarden.eu' | 'self-hosted';
    customServerUrl: string;
    customCertPath: string;
    autoLockTimeout: string;
    passwordLength: string;
    passwordUppercase: boolean;
    passwordLowercase: boolean;
    passwordNumbers: boolean;
    passwordSymbols: boolean;
  }> = {},
) {
  return {
    serverRegion: 'bitwarden.com' as const,
    customServerUrl: '',
    customCertPath: '',
    apiClientId: 'x',
    apiClientSecret: 'x',
    autoLockTimeout: '21600',
    passwordLength: '20',
    passwordUppercase: true,
    passwordLowercase: true,
    passwordNumbers: true,
    passwordSymbols: true,
    ...overrides,
  };
}

describe('getServerUrl', () => {
  it('returns https://bitwarden.com for US cloud region', () => {
    expect(getServerUrl(prefs({ serverRegion: 'bitwarden.com' }))).toBe('https://bitwarden.com');
  });

  it('returns https://bitwarden.eu for EU cloud region', () => {
    expect(getServerUrl(prefs({ serverRegion: 'bitwarden.eu' }))).toBe('https://bitwarden.eu');
  });

  it('returns custom server URL for self-hosted region', () => {
    expect(
      getServerUrl(
        prefs({ serverRegion: 'self-hosted', customServerUrl: 'https://vault.example.com' }),
      ),
    ).toBe('https://vault.example.com');
  });

  it('strips trailing slashes from self-hosted URL', () => {
    expect(
      getServerUrl(
        prefs({ serverRegion: 'self-hosted', customServerUrl: 'https://vault.example.com///' }),
      ),
    ).toBe('https://vault.example.com');
  });

  it('throws when self-hosted URL is empty', () => {
    expect(() => getServerUrl(prefs({ serverRegion: 'self-hosted', customServerUrl: '' }))).toThrow(
      'Custom Server URL is required',
    );
  });

  it('throws when self-hosted URL is whitespace only', () => {
    expect(() =>
      getServerUrl(prefs({ serverRegion: 'self-hosted', customServerUrl: '   ' })),
    ).toThrow('Custom Server URL is required');
  });
});

describe('getAutoLockSeconds', () => {
  it('returns 0 for "Never" (value "0")', () => {
    expect(getAutoLockSeconds(prefs({ autoLockTimeout: '0' }))).toBe(0);
  });

  it('returns 900 for 15 minutes', () => {
    expect(getAutoLockSeconds(prefs({ autoLockTimeout: '900' }))).toBe(900);
  });

  it('returns 21600 for 6 hours (default)', () => {
    expect(getAutoLockSeconds(prefs({ autoLockTimeout: '21600' }))).toBe(21600);
  });

  it('returns 0 for invalid values', () => {
    expect(getAutoLockSeconds(prefs({ autoLockTimeout: 'invalid' }))).toBe(0);
  });

  it('returns 0 for negative values', () => {
    expect(getAutoLockSeconds(prefs({ autoLockTimeout: '-500' }))).toBe(0);
  });
});
