import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSharedCaptureRecorded } from "../screenshots/sharedStore";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const STARTED_AT = "2026-10-30T12:00:00.000Z";
const HOLDER = 4242;
// The capturing process's ancestry: the screenshots run under the holder.
const underHolder = () => [process.pid, 4300, HOLDER, 1];

interface Clone {
  repo: string;
  store: string;
  project: string;
}

// A clone whose .screenshots links to `<artifacts>/tearleads/screenshots`.
function linkedClone(): Clone {
  const root = mkdtempSync(join(tmpdir(), "shared-store-"));
  roots.push(root);
  const repo = join(root, "repo");
  const project = join(root, "artifacts", "tearleads");
  const store = join(project, "screenshots");
  mkdirSync(repo);
  mkdirSync(store, { recursive: true });
  symlinkSync(store, join(repo, ".screenshots"));
  return { repo, store, project };
}

function writeCapture(
  { repo, store, project }: Clone,
  overrides: {
    status?: string;
    lock?: Record<string, unknown> | null;
    record?: Record<string, unknown>;
  } = {},
): void {
  const owner = { host: hostname(), checkout: repo, startedAt: STARTED_AT };
  rmSync(join(project, ".capture.lock"), { force: true });
  if (overrides.lock !== null) {
    writeFileSync(
      join(project, ".capture.lock"),
      JSON.stringify({ pid: HOLDER, ...owner, ...overrides.lock }),
    );
  }
  writeFileSync(
    join(store, "capture.json"),
    JSON.stringify({
      status: overrides.status ?? "running",
      ...owner,
      ...overrides.record,
    }),
  );
}

function screenshotConfigClone() {
  const clone = linkedClone();
  const appWeb = join(clone.repo, "packages/app-web");
  mkdirSync(join(appWeb, "screenshots"), { recursive: true });
  mkdirSync(join(appWeb, "probe"));
  writeFileSync(join(appWeb, "package.json"), '{"type":"module"}');
  symlinkSync(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(appWeb, "node_modules"),
  );
  for (const file of [
    "playwright.screenshots.config.ts",
    "screenshots/sharedStore.ts",
  ]) {
    copyFileSync(new URL(`../${file}`, import.meta.url), join(appWeb, file));
  }
  return { ...clone, appWeb };
}

test("linked screenshot configuration can be inspected without starting a capture", () => {
  const clone = screenshotConfigClone();
  const result = spawnSync(
    process.execPath,
    ["-e", 'await import("./playwright.screenshots.config.ts")'],
    { cwd: clone.appWeb, encoding: "utf8" },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

test("Playwright checks the capture lock before executing any capture test", () => {
  const clone = screenshotConfigClone();
  writeFileSync(
    join(clone.appWeb, "probe.config.ts"),
    `import config from "./playwright.screenshots.config";
export default { ...config, testDir: "./probe", projects: undefined, webServer: undefined };`,
  );
  writeFileSync(
    join(clone.appWeb, "probe/capture.spec.ts"),
    `import { test } from "@playwright/test";
import { writeFileSync } from "node:fs";
test("capture", () => writeFileSync("capture-ran", "yes"));`,
  );
  const run = () =>
    spawnSync(
      "node",
      [
        fileURLToPath(
          new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
        ),
        "test",
        "--config=probe.config.ts",
      ],
      { cwd: clone.appWeb, encoding: "utf8" },
    );
  const refused = run();
  expect(refused.status).not.toBe(0);
  expect(refused.stdout + refused.stderr).toContain(refusal);
  expect(existsSync(join(clone.appWeb, "capture-ran"))).toBe(false);
  writeCapture(clone, { lock: { pid: process.pid } });
  const admitted = run();
  expect(admitted.stdout + admitted.stderr).not.toContain(refusal);
  expect(admitted.status, admitted.stdout + admitted.stderr).toBe(0);
  expect(existsSync(join(clone.appWeb, "capture-ran"))).toBe(true);
}, 30_000);

const refusal = "capture through its `artifacts capture`";

test("an unlinked clone captures directly", () => {
  const root = mkdtempSync(join(tmpdir(), "shared-store-"));
  roots.push(root);
  expect(() => assertSharedCaptureRecorded(root)).not.toThrow();
  mkdirSync(join(root, ".screenshots"));
  expect(() => assertSharedCaptureRecorded(root)).not.toThrow();
});

test("a linked clone captures under its own locked, running capture", () => {
  const clone = linkedClone();
  writeCapture(clone);
  expect(() =>
    assertSharedCaptureRecorded(clone.repo, underHolder),
  ).not.toThrow();
});

test("a linked clone refuses a capture without a running record", () => {
  const clone = linkedClone();
  expect(() => assertSharedCaptureRecorded(clone.repo, underHolder)).toThrow(
    refusal,
  );
  for (const status of ["complete", "failed"]) {
    writeCapture(clone, { status });
    expect(
      () => assertSharedCaptureRecorded(clone.repo, underHolder),
      status,
    ).toThrow(refusal);
  }
});

test("a run that the lock holder did not start is refused", () => {
  const clone = linkedClone();
  writeCapture(clone);
  // Same checkout and host, but outside the holder's process tree.
  expect(() =>
    assertSharedCaptureRecorded(clone.repo, () => [process.pid, 4300, 1]),
  ).toThrow(refusal);
});

test("the real process chain is not under an unrelated lock holder", () => {
  const clone = linkedClone();
  writeCapture(clone);
  expect(() => assertSharedCaptureRecorded(clone.repo)).toThrow(refusal);
  writeCapture(clone, { lock: { pid: process.pid } });
  expect(() => assertSharedCaptureRecorded(clone.repo)).not.toThrow();
});

test("a stale running record without its lock is refused", () => {
  const clone = linkedClone();
  writeCapture(clone, { lock: null });
  expect(() => assertSharedCaptureRecorded(clone.repo, underHolder)).toThrow(
    refusal,
  );
  // A lock newer than the record means the record is left from another run.
  writeCapture(clone, { lock: { startedAt: "2026-10-30T13:00:00.000Z" } });
  expect(() => assertSharedCaptureRecorded(clone.repo, underHolder)).toThrow(
    refusal,
  );
});

test("another clone's or host's capture does not admit a direct one", () => {
  const clone = linkedClone();
  const other = join(clone.project, "..", "..", "other");
  mkdirSync(other);
  for (const owner of [
    { checkout: other },
    { checkout: join(other, "gone") },
    { host: `${hostname()}-elsewhere` },
  ]) {
    writeCapture(clone, { lock: owner, record: owner });
    expect(
      () => assertSharedCaptureRecorded(clone.repo, underHolder),
      JSON.stringify(owner),
    ).toThrow(refusal);
    // A lock held for another clone does not cover this clone's record.
    writeCapture(clone, { lock: owner });
    expect(
      () => assertSharedCaptureRecorded(clone.repo, underHolder),
      `lock ${JSON.stringify(owner)}`,
    ).toThrow(refusal);
  }
});
