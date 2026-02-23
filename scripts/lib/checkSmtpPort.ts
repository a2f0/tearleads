#!/usr/bin/env -S pnpm exec tsx
/**
 * Check if SMTP port is in use and kill existing listener if from this repo.
 * Usage: tsx scripts/lib/checkSmtpPort.ts
 */
import path from 'node:path';
import { createExitOnce, isPortInUse, parsePort } from './portHelpers.ts';
import {
  getPidsOnPort,
  getProcessCwd,
  isPidAlive,
  killPid,
  resolveRealPath,
  resolveRepoRoot,
  sleep
} from './processHelpers.ts';

const host = process.env.SMTP_HOST || '127.0.0.1';
const port = parsePort(process.env.SMTP_PORT || '25');
const timeoutMs = Number.parseInt(
  process.env.SMTP_PORT_CHECK_TIMEOUT_MS || '500',
  10
);
const repoRoot = resolveRepoRoot();
const SIGTERM_WAIT_MS = 200;
const SIGKILL_WAIT_MS = 100;
const POST_KILL_WAIT_MS = 100;

if (port === null) {
  console.error(`Invalid SMTP_PORT: ${process.env.SMTP_PORT}`);
  process.exit(2);
}

const isInRepo = (cwd: string | null): boolean => {
  if (!cwd) {
    return false;
  }
  const resolved = resolveRealPath(cwd);
  if (!resolved) {
    return false;
  }
  if (resolved === repoRoot || resolved.startsWith(`${repoRoot}${path.sep}`)) {
    return true;
  }

  // Also check if it's a tearleads SMTP listener from another clone
  // (tearleads2, tearleads5, tearleads-shared, etc. are all clones of the same repo)
  return (
    resolved.includes('/smtp-listener') && /\/tearleads[^/]*\//.test(resolved)
  );
};

const killExistingListeners = async (pids: number[]): Promise<boolean> => {
  const pidsToKill = pids.filter((pid) => isInRepo(getProcessCwd(pid)));

  if (pidsToKill.length === 0) {
    return false;
  }

  console.log(
    `[checkSmtpPort] Killing existing SMTP listener(s) on port ${port}: PID(s) ${pidsToKill.join(', ')}`
  );

  for (const pid of pidsToKill) {
    killPid(pid, 'SIGTERM');
  }
  await sleep(SIGTERM_WAIT_MS);

  let needsSigKillWait = false;
  for (const pid of pidsToKill) {
    if (isPidAlive(pid)) {
      killPid(pid, 'SIGKILL');
      needsSigKillWait = true;
    }
  }

  if (needsSigKillWait) {
    await sleep(SIGKILL_WAIT_MS);
  }

  return true;
};

const finish = createExitOnce();

const main = async (): Promise<void> => {
  // First check if port is in use
  const pids = getPidsOnPort({ port });
  if (pids.length === 0) {
    finish(0);
    return;
  }

  // Try to kill existing listeners if they're from this repo
  const killed = await killExistingListeners(pids);
  if (killed) {
    // Verify port is now free
    await sleep(POST_KILL_WAIT_MS);
    const stillInUsePids = getPidsOnPort({ port });
    if (stillInUsePids.length === 0) {
      finish(0);
      return;
    }
  }

  // Port still in use by external process
  const inUse = await isPortInUse({ host, port, timeoutMs });
  if (!inUse) {
    finish(0);
    return;
  }

  console.error(`Port ${port} already has a listener on ${host}.`);
  finish(1);
};

main().catch((error: unknown) => {
  console.error('[checkSmtpPort] Error:', error);
  finish(1);
});
