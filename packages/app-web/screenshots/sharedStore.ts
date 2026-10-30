import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// A linked clone's `.screenshots` is a symlink into the matrix-artifacts store
// that every clone of this repository builds and deploys from. Only the store's
// `artifacts capture` may write there: it takes the project's capture lock and
// writes a `running` record to `.screenshots/capture.json` before it runs
// `bun run screenshots`, so website builds can refuse an unfinished or
// overlapping capture. A direct capture into the store would replace images
// under the previous `complete` record, or under another clone's running
// capture, so it is refused unless the running record names this clone and
// host. An unlinked clone
// keeps a plain local `.screenshots` directory and captures directly.

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

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

interface CaptureRecord {
  status?: string;
  checkout?: string;
  host?: string;
}

function readRecord(screenshotsDir: string): CaptureRecord | undefined {
  try {
    return JSON.parse(
      readFileSync(path.join(screenshotsDir, "capture.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** Refuses a capture into the shared store that `artifacts capture` did not start. */
export function assertSharedCaptureRecorded(repoRoot = REPO_ROOT): void {
  const screenshotsDir = path.join(repoRoot, ".screenshots");
  if (!isSymlink(screenshotsDir)) {
    return;
  }
  const record = readRecord(screenshotsDir);
  if (
    record?.status !== "running" ||
    record.host !== hostname() ||
    typeof record.checkout !== "string" ||
    resolved(record.checkout) !== resolved(repoRoot)
  ) {
    throw new Error(
      ".screenshots links to the shared screenshot store; capture through its `artifacts capture`, which locks the store and records the capture.",
    );
  }
}

if (import.meta.main) {
  assertSharedCaptureRecorded();
}
