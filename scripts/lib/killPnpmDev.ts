#!/usr/bin/env -S pnpm exec tsx
/**
 * Kill existing pnpm dev processes running from this repo.
 * Usage: tsx scripts/lib/killPnpmDev.ts
 *
 * Note: relies on `ps` and `lsof` output formats commonly available on macOS.
 *
 * Cooldown mechanism: After running, writes a marker file. Subsequent invocations
 * within COOLDOWN_MS skip the kill step. This allows the root `pnpm dev` to kill
 * processes once, while child dev scripts (spawned via concurrently) skip redundant kills.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getPidsOnPort,
  getProcessCwd,
  isCwdWithinRepo,
  isPidAlive,
  killPid,
  resolveRepoRoot,
  sleep
} from './processHelpers.ts';

type ProcessInfo = {
  pid: number;
  ppid: number;
  command: string;
};

const COOLDOWN_MS = 10_000; // 10 seconds
const PORT_RELEASE_MAX_WAIT_MS = 2000;
const PORT_RELEASE_POLL_INTERVAL_MS = 100;

const repoRoot = resolveRepoRoot();

// Create a unique marker file path based on repo root
const repoHash = createHash('md5').update(repoRoot).digest('hex').slice(0, 8);
const markerDir = path.join(os.tmpdir(), 'tearleads-dev-kill');
const markerFile = path.join(markerDir, `${repoHash}.marker`);

const isWithinCooldown = (): boolean => {
  try {
    const stat = statSync(markerFile);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs < COOLDOWN_MS;
  } catch {
    return false;
  }
};

const writeMarker = (): void => {
  try {
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(markerFile, String(Date.now()));
  } catch {
    // Ignore - marker is optional optimization
  }
};

const parseProcessList = (output: string): ProcessInfo[] => {
  const lines = output.trim().split('\n');
  const processes: ProcessInfo[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const pidText = match[1];
    const ppidText = match[2];
    const command = match[3];
    if (
      pidText === undefined ||
      ppidText === undefined ||
      command === undefined
    ) {
      continue;
    }

    const pid = Number.parseInt(pidText, 10);
    const ppid = Number.parseInt(ppidText, 10);

    if (Number.isNaN(pid) || Number.isNaN(ppid)) {
      continue;
    }

    processes.push({ pid, ppid, command });
  }

  return processes;
};

const getProcessList = (): ProcessInfo[] => {
  const output = execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8'
  });
  return parseProcessList(output);
};

const buildPpidMap = (processes: ProcessInfo[]): Map<number, number> => {
  const map = new Map<number, number>();
  for (const proc of processes) {
    map.set(proc.pid, proc.ppid);
  }
  return map;
};

const getAncestorPids = (
  pid: number,
  ppidMap: Map<number, number>
): Set<number> => {
  const ancestors = new Set<number>();
  let current: number | undefined = pid;

  while (current && !ancestors.has(current)) {
    ancestors.add(current);
    const parent = ppidMap.get(current);
    if (!parent || parent <= 1) {
      break;
    }
    current = parent;
  }

  return ancestors;
};

const isInRepo = (cwd: string | null): boolean => {
  return isCwdWithinRepo({ cwd, repoRoot });
};

// Dev ports that should be freed before starting
const DEV_PORTS = [25, 3000, 3001, 5001];

const getProcessOnPort = (port: number): number | null => {
  const pids = getPidsOnPort({ port, listenOnly: true });
  return pids[0] ?? null;
};

const isPortFree = (port: number): boolean => {
  return getProcessOnPort(port) === null;
};

const main = async (): Promise<void> => {
  if (process.env['TEARLEADS_SKIP_DEV_KILL'] === '1') {
    return;
  }

  // Skip if another dev process in this repo ran kill recently
  // Use --force flag to bypass cooldown (for root dev script)
  if (!process.argv.includes('--force') && isWithinCooldown()) {
    return;
  }

  // Write marker immediately to prevent concurrent sibling processes (e.g.,
  // api and client dev scripts starting simultaneously) from all entering the
  // kill path and killing each other's newly-started servers.
  writeMarker();

  const processes = getProcessList();
  const ppidMap = buildPpidMap(processes);
  const ancestors = getAncestorPids(process.pid, ppidMap);

  const pnpmDevRegex = /\bpnpm\b.*\bdev\b/;
  const candidates = processes.filter((proc) =>
    pnpmDevRegex.test(proc.command)
  );

  const targets = candidates
    .filter((proc) => !ancestors.has(proc.pid))
    .filter((proc) => isInRepo(getProcessCwd(proc.pid)));

  // Also find processes holding dev ports (from any tearleads clone, not just this repo)
  // This ensures port conflicts are resolved even when switching between workspaces
  const portPids = DEV_PORTS.map(getProcessOnPort).filter(
    (pid): pid is number => pid !== null && !ancestors.has(pid)
  );

  // Combine pnpm dev targets with port-holding processes
  const allTargetPids = [
    ...new Set([...targets.map((proc) => proc.pid), ...portPids])
  ];

  if (allTargetPids.length === 0) {
    return;
  }

  console.log(
    `[killPnpmDev] Stopping existing dev processes: ${allTargetPids.join(', ')}`
  );

  for (const pid of allTargetPids) {
    killPid(pid, 'SIGTERM');
  }

  await sleep(200);

  for (const pid of allTargetPids) {
    if (isPidAlive(pid)) {
      killPid(pid, 'SIGKILL');
    }
  }

  // Wait for ports to be released (OS may take time to free them)
  let waited = 0;
  let allPortsAreFree = false;
  while (waited < PORT_RELEASE_MAX_WAIT_MS) {
    allPortsAreFree = DEV_PORTS.every(isPortFree);
    if (allPortsAreFree) {
      break;
    }
    await sleep(PORT_RELEASE_POLL_INTERVAL_MS);
    waited += PORT_RELEASE_POLL_INTERVAL_MS;
  }

  if (!allPortsAreFree) {
    const busyPorts = DEV_PORTS.filter((port) => !isPortFree(port));
    console.warn(
      `[killPnpmDev] Timed out waiting for ports to be released: ${busyPorts.join(', ')}`
    );
  }

  // Refresh marker for accurate cooldown timing after kill completes
  writeMarker();
};

main().catch((error: unknown) => {
  console.error('[killPnpmDev] Error:', error);
  process.exit(1);
});
