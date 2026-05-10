import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockExecFile = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());
const { mockGetPreferences, mockGetAutoLockSeconds } = vi.hoisted(() => ({
  mockGetPreferences: vi.fn(),
  mockGetAutoLockSeconds: vi.fn(),
}));

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

vi.mock('../preferences', () => ({
  getPreferences: mockGetPreferences,
  getAutoLockSeconds: mockGetAutoLockSeconds,
}));

let sessionStore: typeof import('../session-store');

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  mockGetAutoLockSeconds.mockReturnValue(0);
  mockGetPreferences.mockReturnValue({ autoLockTimeout: '0' });
  sessionStore = await import('../session-store');
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

function mockSpawnError(code: number) {
  const child = {
    stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() },
    on: vi.fn(),
  };
  child.stdin.on.mockImplementation((event: string, cb: () => void) => {
    if (event === 'finish') cb();
    return child;
  });
  child.on.mockImplementation((event: string, cb: (code?: number) => void) => {
    if (event === 'close') cb(code);
    return child;
  });
  mockSpawn.mockReturnValueOnce(child);
  return child;
}

describe('checkSecretToolInstalled', () => {
  it('returns true when secret-tool lookup succeeds', async () => {
    mockExec('session-token\n');
    const result = await sessionStore.checkSecretToolInstalled();
    expect(result).toBe(true);
  });

  it('returns false when secret-tool is not found (ENOENT)', async () => {
    const err = new Error('spawn ENOENT') as Error & { code: string };
    err.code = 'ENOENT';
    mockExecFile.mockRejectedValueOnce(err);

    const result = await sessionStore.checkSecretToolInstalled();
    expect(result).toBe(false);
  });

  it('returns true when lookup fails for other reasons (key not found)', async () => {
    mockExecError('secret-tool: Cannot find item');

    const result = await sessionStore.checkSecretToolInstalled();
    expect(result).toBe(true);
  });

  it('caches result after first call', async () => {
    mockExec('token\n');

    await sessionStore.checkSecretToolInstalled();
    await sessionStore.checkSecretToolInstalled();

    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});

describe('getSession', () => {
  it('returns null when secret-tool lookup fails', async () => {
    mockExecError('secret-tool: Cannot find item');
    const result = await sessionStore.getSession();
    expect(result).toBeNull();
  });

  it('returns null when stdout is empty', async () => {
    mockExec('\n');
    const result = await sessionStore.getSession();
    expect(result).toBeNull();
  });

  it('returns token from valid session payload (new format)', async () => {
    const payload = JSON.stringify({ token: 'session-abc', timestamp: Date.now() });
    mockExec(payload + '\n');

    const result = await sessionStore.getSession();
    expect(result).toBe('session-abc');
  });

  it('returns null for expired session', async () => {
    mockGetAutoLockSeconds.mockReturnValue(900); // 15 min timeout
    const oldTimestamp = Date.now() - 1000 * 1000; // ~16 min ago — expired
    const payload = JSON.stringify({ token: 'expired-token', timestamp: oldTimestamp });
    mockExec(payload + '\n');

    // deleteSession will be called for expiry — mock it
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await sessionStore.getSession();
    expect(result).toBeNull();
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      'secret-tool',
      ['clear', 'service', 'vicinae-bitwarden', 'account', 'session'],
      expect.any(Object),
    );
  });

  it('does not expire when autoLockTimeout is 0', async () => {
    mockGetAutoLockSeconds.mockReturnValue(0);
    const oldTimestamp = Date.now() - 1000 * 1000;
    const payload = JSON.stringify({ token: 'still-valid', timestamp: oldTimestamp });
    mockExec(payload + '\n');

    const result = await sessionStore.getSession();
    expect(result).toBe('still-valid');
  });

  it('returns raw token for old format (backward compat)', async () => {
    mockExec('legacy-session-token\n');

    const result = await sessionStore.getSession();
    expect(result).toBe('legacy-session-token');
  });

  it('passes correct args to secret-tool lookup', async () => {
    const payload = JSON.stringify({ token: 'tok', timestamp: Date.now() });
    mockExec(payload + '\n');

    await sessionStore.getSession();

    expect(mockExecFile).toHaveBeenCalledWith(
      'secret-tool',
      ['lookup', 'service', 'vicinae-bitwarden', 'account', 'session'],
      expect.objectContaining({ timeout: 5000 }),
    );
  });
});

describe('setSession', () => {
  it('stores session with current timestamp via secret-tool spawn', async () => {
    const before = Date.now();
    mockSpawnSuccess();

    await sessionStore.setSession('my-session-token');

    expect(mockSpawn).toHaveBeenCalledWith(
      'secret-tool',
      ['store', '--label=Vicinae Bitwarden', 'service', 'vicinae-bitwarden', 'account', 'session'],
      expect.objectContaining({ stdio: ['pipe', 'ignore', 'ignore'] }),
    );

    const child = mockSpawn.mock.results[0].value;
    const writtenData = child.stdin.write.mock.calls[0][0];
    const parsed = JSON.parse(writtenData);
    expect(parsed.token).toBe('my-session-token');
    expect(parsed.timestamp).toBeGreaterThanOrEqual(before);
    expect(parsed.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('rejects when spawn process exits with non-zero code', async () => {
    mockSpawnError(1);

    await expect(sessionStore.setSession('token')).rejects.toThrow(
      'secret-tool exited with code 1',
    );
  });

  it('rejects when spawn emits error', async () => {
    const child = {
      stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() },
      on: vi.fn(),
    };
    child.stdin.on.mockImplementation((event: string, cb: () => void) => {
      if (event === 'finish') cb();
      return child;
    });
    child.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'error') cb(new Error('spawn failed'));
      return child;
    });
    mockSpawn.mockReturnValueOnce(child);

    await expect(sessionStore.setSession('token')).rejects.toThrow('spawn failed');
  });
});

describe('deleteSession', () => {
  it('calls secret-tool clear with correct args', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

    await sessionStore.deleteSession();

    expect(mockExecFile).toHaveBeenCalledWith(
      'secret-tool',
      ['clear', 'service', 'vicinae-bitwarden', 'account', 'session'],
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it('does not throw when clear fails', async () => {
    mockExecError('secret-tool: Cannot find item');

    await expect(sessionStore.deleteSession()).resolves.toBeUndefined();
  });
});
