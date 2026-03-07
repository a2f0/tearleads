import { type ChildProcess, spawn as spawnProcess } from 'node:child_process';
import { once } from 'node:events';
import { open, stat, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect as connectSocket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const READY_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 250;
const MAX_STDERR_BYTES = 4_096;
const STARTUP_LOCK_TIMEOUT_MS = 180_000;
const STARTUP_LOCK_STALE_MS = 300_000;
const STARTUP_RETRY_DELAY_MS = 1_000;
const MAX_STARTUP_ATTEMPTS = 5;
const API_V2_HARNESS_ENV_KEY = 'API_V2_ENABLE_ADMIN_HARNESS';
const STARTUP_LOCK_PATH = resolve(
  tmpdir(),
  'tearleads-api-v2-harness-start.lock'
);
const RETRYABLE_BOOTSTRAP_PATTERNS = [
  /syncing channel updates/i,
  /component download failed/i,
  /could not read downloaded file/i,
  /cargo binary.*not applicable/i,
  /not applicable to .*toolchain/i,
  /could not rename component file/i
];

const SOURCE_DIR = dirname(fileURLToPath(new URL(import.meta.url)));
const WORKSPACE_ROOT = resolve(SOURCE_DIR, '..', '..', '..');

export interface ApiV2ServiceHarness {
  port: number;
  stop: () => Promise<void>;
}

export interface ApiV2ServiceHarnessDependencies {
  spawn: typeof spawnProcess;
  open: typeof open;
  stat: typeof stat;
  unlink: typeof unlink;
  createServer: typeof createServer;
  connectSocket: typeof connectSocket;
  delay: typeof delay;
  now: () => number;
}

const defaultDependencies: ApiV2ServiceHarnessDependencies = {
  spawn: spawnProcess,
  open,
  stat,
  unlink,
  createServer,
  connectSocket,
  delay,
  now: () => Date.now()
};

function getErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  if (!('code' in error)) {
    return null;
  }
  if (typeof error.code !== 'string') {
    return null;
  }
  return error.code;
}

function truncateForErrorLog(value: string): string {
  if (value.length <= MAX_STDERR_BYTES) {
    return value;
  }
  return value.slice(value.length - MAX_STDERR_BYTES);
}

function shouldRetryBootstrap(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return RETRYABLE_BOOTSTRAP_PATTERNS.some((pattern) =>
    pattern.test(error.message)
  );
}

async function acquireStartupLock(
  dependencies: ApiV2ServiceHarnessDependencies
): Promise<() => Promise<void>> {
  const deadline = dependencies.now() + STARTUP_LOCK_TIMEOUT_MS;

  while (dependencies.now() < deadline) {
    try {
      const handle = await dependencies.open(STARTUP_LOCK_PATH, 'wx');
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();

      let released = false;
      return async () => {
        if (released) {
          return;
        }
        released = true;
        try {
          await dependencies.unlink(STARTUP_LOCK_PATH);
        } catch (error) {
          if (getErrorCode(error) !== 'ENOENT') {
            throw error;
          }
        }
      };
    } catch (error) {
      if (getErrorCode(error) !== 'EEXIST') {
        throw error;
      }

      try {
        const lockStats = await dependencies.stat(STARTUP_LOCK_PATH);
        const lockIsStale =
          dependencies.now() - lockStats.mtimeMs > STARTUP_LOCK_STALE_MS;
        if (lockIsStale) {
          await dependencies.unlink(STARTUP_LOCK_PATH);
          continue;
        }
      } catch (statError) {
        if (getErrorCode(statError) !== 'ENOENT') {
          throw statError;
        }
      }

      await dependencies.delay(POLL_INTERVAL_MS);
    }
  }

  throw new Error('timed out waiting for api-v2 harness startup lock');
}

async function allocatePort(
  dependencies: ApiV2ServiceHarnessDependencies
): Promise<number> {
  const server = dependencies.createServer();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });

  const address = server.address();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });

  if (address === null || typeof address === 'string') {
    throw new Error('failed to allocate API v2 harness port');
  }

  return address.port;
}

function startHarnessProcess(
  port: number,
  dependencies: ApiV2ServiceHarnessDependencies
): ChildProcess {
  return dependencies.spawn(
    'cargo',
    ['run', '--quiet', '--package', 'tearleads-api-v2'],
    {
      cwd: WORKSPACE_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        [API_V2_HARNESS_ENV_KEY]: '1'
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );
}

async function waitForReadiness(
  process: ChildProcess,
  port: number,
  stderrBuffer: { value: string },
  dependencies: ApiV2ServiceHarnessDependencies
): Promise<void> {
  const deadline = dependencies.now() + READY_TIMEOUT_MS;
  let lastError = 'socket is not yet accepting connections';

  while (dependencies.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        `api-v2 harness exited before readiness (code ${String(process.exitCode)}): ${stderrBuffer.value}`
      );
    }

    const isReady = await new Promise<boolean>((resolveReady) => {
      const socket = dependencies.connectSocket({ host: '127.0.0.1', port });

      socket.once('connect', () => {
        socket.destroy();
        resolveReady(true);
      });

      socket.once('error', (error) => {
        socket.destroy();
        lastError = error.message;
        resolveReady(false);
      });
    });

    if (isReady) {
      return;
    }

    await dependencies.delay(POLL_INTERVAL_MS);
  }

  throw new Error(
    `timed out waiting for api-v2 harness readiness: ${lastError}`
  );
}

async function stopProcess(
  process: ChildProcess,
  dependencies: ApiV2ServiceHarnessDependencies
): Promise<void> {
  if (process.exitCode !== null) {
    return;
  }

  process.kill('SIGTERM');

  const exited = await Promise.race([
    once(process, 'exit').then(() => true),
    dependencies.delay(5_000).then(() => false)
  ]);
  if (!exited) {
    process.kill('SIGKILL');
    await once(process, 'exit');
  }
}

export async function startApiV2ServiceHarness(
  dependencyOverrides: Partial<ApiV2ServiceHarnessDependencies> = {}
): Promise<ApiV2ServiceHarness> {
  const dependencies: ApiV2ServiceHarnessDependencies = {
    ...defaultDependencies,
    ...dependencyOverrides
  };
  const releaseStartupLock = await acquireStartupLock(dependencies);

  try {
    for (let attempt = 1; attempt <= MAX_STARTUP_ATTEMPTS; attempt += 1) {
      const port = await allocatePort(dependencies);
      const process = startHarnessProcess(port, dependencies);
      const stderrBuffer = { value: '' };

      process.stderr?.setEncoding('utf8');
      process.stderr?.on('data', (chunk: string) => {
        stderrBuffer.value = truncateForErrorLog(
          `${stderrBuffer.value}${chunk}`
        );
      });

      try {
        await waitForReadiness(process, port, stderrBuffer, dependencies);
      } catch (error) {
        await stopProcess(process, dependencies);

        const canRetry =
          attempt < MAX_STARTUP_ATTEMPTS && shouldRetryBootstrap(error);
        if (!canRetry) {
          throw error;
        }

        await dependencies.delay(STARTUP_RETRY_DELAY_MS * attempt);
        continue;
      }

      return {
        port,
        stop: async () => stopProcess(process, dependencies)
      };
    }

    throw new Error('failed to start api-v2 harness after retry budget');
  } finally {
    await releaseStartupLock();
  }
}
