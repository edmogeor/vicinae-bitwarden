import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockExecFile = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockJoin = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => {
  return {
    default: { execFile: mockExecFile, spawn: mockSpawn },
    execFile: mockExecFile,
    spawn: mockSpawn,
  };
});

vi.mock('node:util', () => {
  return {
    default: { promisify: (fn: unknown) => fn },
    promisify: (fn: unknown) => fn,
  };
});

vi.mock('node:fs', () => ({
  default: { readFileSync: mockReadFileSync, writeFileSync: mockWriteFileSync },
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('node:path', () => ({
  default: { join: mockJoin },
  join: mockJoin,
}));

vi.mock('better-sqlite3', () => ({
  default: function Database() {
    return {
      prepare: vi.fn().mockReturnValue({ run: vi.fn() }),
      close: vi.fn(),
    };
  },
}));

let apiCredStore: typeof import('../api-credential-store');

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  mockJoin.mockImplementation((...args: string[]) => args.join('/'));
  process.env.HOME = '/home/testuser';
  apiCredStore = await import('../api-credential-store');
});

function mockExec(stdout: string, stderr = '') {
  mockExecFile.mockResolvedValueOnce({ stdout, stderr });
}

function mockExecError(message: string) {
  const err = new Error(message) as Error & { stderr: string; code: number };
  err.stderr = message;
  err.code = 1;
  mockExecFile.mockRejectedValueOnce(err);
}

function mockSpawnSuccess() {
  const child = {
    stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() },
    on: vi.fn(),
  };
  child.stdin.on.mockImplementation((event: string, cb: () => void) => {
    if (event === 'finish') cb();
    return child;
  });
  child.on.mockImplementation((event: string, cb: (code?: number) => void) => {
    if (event === 'close') cb(0);
    return child;
  });
  mockSpawn.mockReturnValueOnce(child);
  return child;
}

describe('storeApiCredentials', () => {
  it('stores credentials as JSON via secret-tool spawn', async () => {
    mockSpawnSuccess();

    await apiCredStore.storeApiCredentials('my-client-id', 'my-client-secret');

    expect(mockSpawn).toHaveBeenCalledWith(
      'secret-tool',
      [
        'store',
        '--label=Vicinae Bitwarden API Key',
        'service',
        'vicinae-bitwarden',
        'account',
        'api-creds',
      ],
      expect.objectContaining({ stdio: ['pipe', 'ignore', 'ignore'] }),
    );

    const child = mockSpawn.mock.results[0].value;
    const written = child.stdin.write.mock.calls[0][0];
    const parsed = JSON.parse(written);
    expect(parsed).toEqual({ clientId: 'my-client-id', clientSecret: 'my-client-secret' });
  });
});

describe('getApiCredentials', () => {
  it('returns parsed credentials from secret-tool lookup', async () => {
    mockExec(JSON.stringify({ clientId: 'id1', clientSecret: 'sec1' }) + '\n');

    const result = await apiCredStore.getApiCredentials();
    expect(result).toEqual({ clientId: 'id1', clientSecret: 'sec1' });
  });

  it('returns null when lookup fails', async () => {
    mockExecError('secret-tool: Cannot find item');

    const result = await apiCredStore.getApiCredentials();
    expect(result).toBeNull();
  });

  it('returns null when stdout is empty', async () => {
    mockExec('\n');

    const result = await apiCredStore.getApiCredentials();
    expect(result).toBeNull();
  });

  it('passes correct args to secret-tool lookup', async () => {
    mockExec(JSON.stringify({ clientId: 'x', clientSecret: 'y' }) + '\n');

    await apiCredStore.getApiCredentials();

    expect(mockExecFile).toHaveBeenCalledWith(
      'secret-tool',
      ['lookup', 'service', 'vicinae-bitwarden', 'account', 'api-creds'],
      expect.objectContaining({ timeout: 5000 }),
    );
  });
});

describe('deleteApiCredentials', () => {
  it('calls secret-tool clear with correct args', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

    await apiCredStore.deleteApiCredentials();

    expect(mockExecFile).toHaveBeenCalledWith(
      'secret-tool',
      ['clear', 'service', 'vicinae-bitwarden', 'account', 'api-creds'],
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it('does not throw when clear fails', async () => {
    mockExecError('secret-tool: Cannot find item');

    await expect(apiCredStore.deleteApiCredentials()).resolves.toBeUndefined();
  });
});

describe('clearApiCredentialsFromDisk', () => {
  it('clears apiClientId from settings.json', async () => {
    mockReadFileSync.mockReturnValue('{"apiClientId": "old-id", "serverRegion": "bitwarden.com"}');

    await apiCredStore.clearApiCredentialsFromDisk();

    expect(mockReadFileSync).toHaveBeenCalledWith(
      '/home/testuser/.config/vicinae/settings.json',
      'utf-8',
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/home/testuser/.config/vicinae/settings.json',
      '{"apiClientId": "", "serverRegion": "bitwarden.com"}',
      'utf-8',
    );
  });

  it('does not write settings.json when apiClientId is already empty', async () => {
    mockReadFileSync.mockReturnValue('{"apiClientId": "", "other": true}');

    await apiCredStore.clearApiCredentialsFromDisk();

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('handles settings.json read failure gracefully', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    await expect(apiCredStore.clearApiCredentialsFromDisk()).resolves.toBeUndefined();
  });

  it('matches apiClientId surrounded by other JSON fields', async () => {
    mockReadFileSync.mockReturnValue(
      '{\n  "serverRegion": "bitwarden.com",\n  "apiClientId": "secret-id",\n  "passwordLength": "20"\n}',
    );

    await apiCredStore.clearApiCredentialsFromDisk();

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/home/testuser/.config/vicinae/settings.json',
      '{\n  "serverRegion": "bitwarden.com",\n  "apiClientId": "",\n  "passwordLength": "20"\n}',
      'utf-8',
    );
  });
});
