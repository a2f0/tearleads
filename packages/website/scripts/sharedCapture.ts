import { lstat, readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

// `.screenshots` is a symlink into the shared matrix-artifacts store, which
// every clone of this repository publishes from. The take-screenshots skill
// records each capture in `.screenshots/capture.json`, writing a `running`
// record before it touches any image. A build that copies screenshots refuses
// a capture that is unfinished, failed, or taken from uncommitted changes, and
// compares the raw record before and after copying: an unchanged `complete`
// record on both sides proves no capture overlapped the copy. Only `complete`
// is accepted (others include `running`, `failed`, and `incomplete`). Without
// a record, a plain `.screenshots` directory (CI, or a clone not yet linked)
// builds as before, but a linked, non-empty store is refused: its images have
// no known commit until one capture through the skill records them.

interface CaptureRecord {
  status?: string;
  commit?: string;
  dirty?: boolean;
  finishedAt?: string;
  args?: string[];
}

async function readCapture(
  screenshotsDir: string,
): Promise<string | undefined> {
  try {
    return await readFile(path.join(screenshotsDir, "capture.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function describeCapture(raw: string): string {
  const record: CaptureRecord = JSON.parse(raw);
  if (record.status !== "complete") {
    throw new Error(
      `The shared screenshot capture is ${record.status}; wait for it or recapture.`,
    );
  }
  if (record.dirty !== false) {
    throw new Error(
      "The shared screenshots were captured from uncommitted changes; recapture from a commit.",
    );
  }
  if (
    typeof record.commit !== "string" ||
    !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(record.commit)
  ) {
    throw new Error(
      "The shared screenshot capture record names no commit; recapture.",
    );
  }
  const partial = record.args?.length
    ? ` (partial: ${record.args.join(" ")})`
    : "";
  return `Screenshots from ${record.commit.slice(0, 10)}, captured ${record.finishedAt}${partial}.`;
}

async function isSymlink(file: string): Promise<boolean> {
  try {
    return (await lstat(file)).isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** Runs `copy` only against a finished, committed capture that no capture overlapped. */
export async function withSharedCapture<T>(
  screenshotsDir: string,
  copy: () => Promise<T>,
): Promise<T> {
  const before = await readCapture(screenshotsDir);
  if (
    before === undefined &&
    (await isSymlink(screenshotsDir)) &&
    (await readdir(screenshotsDir)).length > 0
  ) {
    throw new Error(
      "The shared screenshots have no capture record; capture once through the take-screenshots skill.",
    );
  }
  if (before !== undefined) {
    console.log(describeCapture(before));
  }
  const result = await copy();
  if ((await readCapture(screenshotsDir)) !== before) {
    throw new Error(
      "A screenshot capture started while copying; build again once it finishes.",
    );
  }
  return result;
}
