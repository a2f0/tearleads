import { readFile } from "node:fs/promises";
import * as path from "node:path";

// `.screenshots` is a symlink into the shared matrix-artifacts store, which
// every clone of this repository publishes from. The take-screenshots skill
// records each capture in `.screenshots/capture.json`, writing a `running`
// record before it touches any image. A build that copies screenshots refuses
// a capture that is unfinished, failed, or taken from uncommitted changes, and
// compares the raw record before and after copying: an unchanged `complete`
// record on both sides proves no capture overlapped the copy. A missing record
// means a direct local capture or none at all (CI has no store), which is
// allowed.

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
  if (record.dirty) {
    throw new Error(
      "The shared screenshots were captured from uncommitted changes; recapture from a commit.",
    );
  }
  const partial = record.args?.length
    ? ` (partial: ${record.args.join(" ")})`
    : "";
  return `Screenshots from ${record.commit?.slice(0, 10)}, captured ${record.finishedAt}${partial}.`;
}

/** Runs `copy` only against a finished, committed capture that no capture overlapped. */
export async function withSharedCapture<T>(
  screenshotsDir: string,
  copy: () => Promise<T>,
): Promise<T> {
  const before = await readCapture(screenshotsDir);
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
