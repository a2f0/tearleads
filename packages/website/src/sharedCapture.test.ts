import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSharedCapture } from "../scripts/sharedCapture";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const COMPLETE = {
  status: "complete",
  commit: "0123456789abcdef0123456789abcdef01234567",
  dirty: false,
  finishedAt: "2026-10-30T12:00:00.000Z",
};

async function screenshotsDir(record?: object): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tearleads-shared-capture-"));
  roots.push(dir);
  if (record !== undefined) {
    await writeFile(join(dir, "capture.json"), JSON.stringify(record));
  }
  return dir;
}

test("a missing capture record is allowed, as in CI", async () => {
  const dir = await screenshotsDir();
  expect(await withSharedCapture(dir, async () => "copied")).toBe("copied");
});

test("a complete capture is copied and its commit is reported", async () => {
  const dir = await screenshotsDir({ ...COMPLETE, args: ["--project=web"] });
  const logged: string[] = [];
  const log = console.log;
  console.log = (line: string) => logged.push(line);
  try {
    expect(await withSharedCapture(dir, async () => 3)).toBe(3);
  } finally {
    console.log = log;
  }
  expect(logged).toEqual([
    "Screenshots from 0123456789, captured 2026-10-30T12:00:00.000Z (partial: --project=web).",
  ]);
});

test("running and failed captures are refused before copying", async () => {
  for (const status of ["running", "failed"]) {
    const dir = await screenshotsDir({ ...COMPLETE, status });
    let copied = false;
    await expect(
      withSharedCapture(dir, async () => {
        copied = true;
      }),
    ).rejects.toThrow(`The shared screenshot capture is ${status}`);
    expect(copied, status).toBe(false);
  }
});

test("a capture from uncommitted changes is refused before copying", async () => {
  const dir = await screenshotsDir({ ...COMPLETE, dirty: true });
  let copied = false;
  await expect(
    withSharedCapture(dir, async () => {
      copied = true;
    }),
  ).rejects.toThrow("captured from uncommitted changes");
  expect(copied).toBe(false);
});

test("a capture that starts while copying fails the build", async () => {
  const dir = await screenshotsDir(COMPLETE);
  await expect(
    withSharedCapture(dir, async () => {
      await writeFile(
        join(dir, "capture.json"),
        JSON.stringify({ ...COMPLETE, status: "running", finishedAt: null }),
      );
    }),
  ).rejects.toThrow("A screenshot capture started while copying");
});

test("a capture that appears while copying without a prior record fails", async () => {
  const dir = await screenshotsDir();
  await expect(
    withSharedCapture(dir, async () => {
      await writeFile(
        join(dir, "capture.json"),
        JSON.stringify({ status: "running" }),
      );
    }),
  ).rejects.toThrow("A screenshot capture started while copying");
});
