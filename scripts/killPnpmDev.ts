/**
 * Kill existing pnpm dev processes running from this repo.
 * Usage: tsx scripts/killPnpmDev.ts
 *
 * Note: relies on `ps` and `lsof` output formats commonly available on macOS.
 *
 * Cooldown mechanism: After running, writes a marker file. Subsequent invocations
 * within COOLDOWN_MS skip the kill step. This allows the root `pnpm dev` to kill
 * processes once, while child dev scripts (spawned via concurrently) skip redundant kills.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  realpathSync,
  statSync,
  writeFileSync,
  mkdirSync,
  rmSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type ProcessInfo = {
  pid: number;
  ppid: number;
  command: string;
};

const COOLDOWN_MS = 10_000; // 10 seconds

const repoRoot = realpathSync(process.cwd());

// Create a unique marker file path based on repo root
const repoHash = createHash('md5').update(repoRoot).digest('hex').slice(0, 8);
const markerDir = path.join(os.tmpdir(), 'rapid-dev-kill');
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

const clearMarker = (): void => {
  try {
    rmSync(markerFile, { force: true });
  } catch {
    // Ignore
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
    const pid = Number.parseInt(match[1], 10);
    const ppid = Number.parseInt(match[2], 10);
    const command = match[3];

    if (Number.isNaN(pid) || Number.isNaN(ppid)) {
      continue;
    }

    processes.push({ pid, ppid, command });
  }

  return processes;
};

const getProcessList = (): ProcessInfo[] => {
  const output = execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
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

const getAncestorPids = (pid: number, ppidMap: Map<number, number>): Set<number> => {
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

    if (!line) {
      return null;
    }

    return line.slice(1);
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
    return resolved === repoRoot || resolved.startsWith(`${repoRoot}${path.sep}`);
  } catch {
    return false;
  }
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const killPid = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal);
  } catch {
    // Ignore errors for already-dead processes or permission issues.
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const main = async (): Promise<void> => {
  // Skip if another dev process in this repo ran kill recently
  if (isWithinCooldown()) {
    return;
  }

  const processes = getProcessList();
  const ppidMap = buildPpidMap(processes);
  const ancestors = getAncestorPids(process.pid, ppidMap);

  const pnpmDevRegex = /\bpnpm\b.*\bdev\b/;
  const candidates = processes.filter((proc) => pnpmDevRegex.test(proc.command));

  const targets = candidates
    .filter((proc) => !ancestors.has(proc.pid))
    .filter((proc) => isInRepo(getProcessCwd(proc.pid)));

  if (targets.length === 0) {
    // No processes to kill, but still write marker to prevent redundant checks
    writeMarker();
    return;
  }

  // Clear marker before killing - ensures fresh cooldown starts after kill completes
  clearMarker();

  const targetPids = targets.map((proc) => proc.pid);
  console.log(`[killPnpmDev] Stopping existing pnpm dev processes: ${targetPids.join(', ')}`);

  for (const pid of targetPids) {
    killPid(pid, 'SIGTERM');
  }

  await sleep(200);

  for (const pid of targetPids) {
    if (isAlive(pid)) {
      killPid(pid, 'SIGKILL');
    }
  }

  // Write marker after successful kill
  writeMarker();
};

main().catch((error: unknown) => {
  console.error('[killPnpmDev] Error:', error);
  process.exit(1);
});
