/**
 * Check if SMTP port is in use and kill existing listener if from this repo.
 * Usage: tsx scripts/checkSmtpPort.ts
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const host = process.env.SMTP_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.SMTP_PORT || '25', 10);
const timeoutMs = Number.parseInt(process.env.SMTP_PORT_CHECK_TIMEOUT_MS || '500', 10);
const repoRoot = realpathSync(process.cwd());

const getProcessCwd = (pid: number): string | null => {
  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = output
      .split('\n')
      .map((value) => value.trim())
      .find((value) => value.startsWith('n'));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
};

const isInRepo = (cwd: string | null): boolean => {
  if (!cwd) {
    return false;
  }
  try {
    const resolved = realpathSync(cwd);
    // Check if it's in the current repo
    if (resolved === repoRoot || resolved.startsWith(`${repoRoot}${path.sep}`)) {
      return true;
    }
    // Also check if it's a rapid SMTP listener from another clone
    // (rapid2, rapid5, rapid-shared, etc. are all clones of the same repo)
    if (resolved.includes('/smtp-listener') && /\/rapid[^/]*\//.test(resolved)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

const getPidOnPort = (): number | null => {
  try {
    const output = execFileSync('lsof', ['-i', `:${port}`, '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids = output
      .trim()
      .split('\n')
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => !Number.isNaN(n));
    return pids.length > 0 ? pids[0] : null;
  } catch {
    return null;
  }
};

const killPid = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal);
  } catch {
    // Ignore errors for already-dead processes.
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const killExistingListener = async (): Promise<boolean> => {
  const pid = getPidOnPort();
  if (!pid) {
    return false;
  }

  const cwd = getProcessCwd(pid);
  if (!isInRepo(cwd)) {
    return false;
  }

  console.log(`[checkSmtpPort] Killing existing SMTP listener (PID ${pid}) on port ${port}`);
  killPid(pid, 'SIGTERM');
  await sleep(200);

  if (isAlive(pid)) {
    killPid(pid, 'SIGKILL');
    await sleep(100);
  }

  return true;
};

let finished = false;
const finish = (code: number): void => {
  if (finished) {
    return;
  }
  finished = true;
  process.exit(code);
};

const checkPort = (): Promise<void> =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      socket.end();
      resolve();
    });

    socket.once('timeout', () => {
      socket.destroy();
      finish(0);
    });

    socket.once('error', () => {
      socket.destroy();
      finish(0);
    });
  });

const main = async (): Promise<void> => {
  // First check if port is in use
  const pid = getPidOnPort();
  if (!pid) {
    finish(0);
    return;
  }

  // Try to kill existing listener if it's from this repo
  const killed = await killExistingListener();
  if (killed) {
    // Verify port is now free
    await sleep(100);
    const stillInUse = getPidOnPort();
    if (!stillInUse) {
      finish(0);
      return;
    }
  }

  // Port still in use by external process
  await checkPort();
  console.error(`Port ${port} already has a listener on ${host}.`);
  finish(1);
};

main().catch((error: unknown) => {
  console.error('[checkSmtpPort] Error:', error);
  finish(1);
});
