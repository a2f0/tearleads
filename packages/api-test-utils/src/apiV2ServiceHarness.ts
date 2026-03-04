import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { connect as connectSocket } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const READY_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 250;
const MAX_STDERR_BYTES = 4_096;
const API_V2_HARNESS_ENV_KEY = 'API_V2_ENABLE_ADMIN_HARNESS';

const SOURCE_DIR = dirname(fileURLToPath(new URL(import.meta.url)));
const WORKSPACE_ROOT = resolve(SOURCE_DIR, '..', '..', '..');

export interface ApiV2ServiceHarness {
  port: number;
  stop: () => Promise<void>;
}

function truncateForErrorLog(value: string): string {
  if (value.length <= MAX_STDERR_BYTES) {
    return value;
  }
  return value.slice(value.length - MAX_STDERR_BYTES);
}

async function allocatePort(): Promise<number> {
  const server = createServer();
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

function startHarnessProcess(port: number): ChildProcess {
  return spawn('cargo', ['run', '--quiet', '--package', 'tearleads-api-v2'], {
    cwd: WORKSPACE_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      [API_V2_HARNESS_ENV_KEY]: '1'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
}

async function waitForReadiness(
  process: ChildProcess,
  port: number,
  stderrBuffer: { value: string }
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = 'socket is not yet accepting connections';

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        `api-v2 harness exited before readiness (code ${String(process.exitCode)}): ${stderrBuffer.value}`
      );
    }

    const isReady = await new Promise<boolean>((resolveReady) => {
      const socket = connectSocket({ host: '127.0.0.1', port });

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

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(
    `timed out waiting for api-v2 harness readiness: ${lastError}`
  );
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) {
    return;
  }

  process.kill('SIGTERM');

  const exited = await Promise.race([
    once(process, 'exit').then(() => true),
    delay(5_000).then(() => false)
  ]);
  if (!exited) {
    process.kill('SIGKILL');
    await once(process, 'exit');
  }
}

export async function startApiV2ServiceHarness(): Promise<ApiV2ServiceHarness> {
  const port = await allocatePort();
  const process = startHarnessProcess(port);
  const stderrBuffer = { value: '' };

  process.stderr?.setEncoding('utf8');
  process.stderr?.on('data', (chunk: string) => {
    stderrBuffer.value = truncateForErrorLog(`${stderrBuffer.value}${chunk}`);
  });

  await waitForReadiness(process, port, stderrBuffer);

  return {
    port,
    stop: async () => stopProcess(process)
  };
}
