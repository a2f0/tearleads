import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// A linked clone's `.screenshots` is a symlink into the matrix-artifacts store
// (`<store>/<project>/screenshots`) that every clone of this repository builds
// and deploys from. Only the store's `artifacts capture` may write there: it
// takes the project's lock (`<store>/<project>/.capture.lock`, naming its pid,
// host, checkout, and start time), writes a matching `running` record to
// `.screenshots/capture.json`, and then runs `bun run screenshots` as its
// child. A capture is admitted only when that lock and record name this clone
// and host and the lock's holder is this process or one of its ancestors, so a
// stale record, another clone's capture, or an unrelated run in this clone
// cannot write images under someone else's provenance. An unlinked clone keeps
// a plain local `.screenshots` directory and captures directly.

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const REFUSAL =
  ".screenshots links to the shared screenshot store; capture through its `artifacts capture`, which locks the store and records the capture.";

interface CaptureLock {
  pid?: number;
  host?: string;
  checkout?: string;
  startedAt?: string;
}

interface CaptureRecord extends CaptureLock {
  status?: string;
}

function isSymlink(file: string): boolean {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function resolved(file: string): string | undefined {
  try {
    return realpathSync(file);
  } catch {
    return undefined;
  }
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function parentOf(pid: number): number | undefined {
  const result = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], {
    encoding: "utf8",
  });
  const parent = Number.parseInt(result.stdout?.trim() ?? "", 10);
  return Number.isInteger(parent) && parent > 0 ? parent : undefined;
}

/** This process and its ancestors, nearest first. */
function processChain(): number[] {
  const chain = [process.pid];
  let pid: number | undefined = process.ppid;
  while (pid !== undefined && pid > 1 && chain.length < 64) {
    chain.push(pid);
    pid = parentOf(pid);
  }
  return chain;
}

function namesThisClone(
  entry: CaptureLock | undefined,
  repoRoot: string,
): boolean {
  return (
    entry?.host === hostname() &&
    typeof entry.checkout === "string" &&
    resolved(entry.checkout) === resolved(repoRoot)
  );
}

/** Refuses a capture into the shared store that `artifacts capture` did not start. */
export function assertSharedCaptureRecorded(
  repoRoot = REPO_ROOT,
  chain: () => number[] = processChain,
): void {
  const screenshotsDir = path.join(repoRoot, ".screenshots");
  if (!isSymlink(screenshotsDir)) {
    return;
  }
  const store = resolved(screenshotsDir);
  if (store === undefined) {
    throw new Error(REFUSAL);
  }
  const lock = readJson<CaptureLock>(
    path.join(path.dirname(store), ".capture.lock"),
  );
  const record = readJson<CaptureRecord>(path.join(store, "capture.json"));
  if (
    record?.status !== "running" ||
    !namesThisClone(lock, repoRoot) ||
    !namesThisClone(record, repoRoot) ||
    lock?.startedAt === undefined ||
    record.startedAt !== lock.startedAt ||
    typeof lock.pid !== "number" ||
    !chain().includes(lock.pid)
  ) {
    throw new Error(REFUSAL);
  }
}

if (import.meta.main) {
  assertSharedCaptureRecorded();
}
