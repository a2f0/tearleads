import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSharedCaptureRecorded } from "../screenshots/sharedStore";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function clone(): { repo: string; store: string } {
  const root = mkdtempSync(join(tmpdir(), "shared-store-"));
  roots.push(root);
  const repo = join(root, "repo");
  const store = join(root, "store");
  mkdirSync(repo);
  mkdirSync(store);
  return { repo, store };
}

function record(store: string, status: string): void {
  writeFileSync(join(store, "capture.json"), JSON.stringify({ status }));
}

test("an unlinked clone captures directly", () => {
  const { repo } = clone();
  expect(() => assertSharedCaptureRecorded(repo)).not.toThrow();
  mkdirSync(join(repo, ".screenshots"));
  expect(() => assertSharedCaptureRecorded(repo)).not.toThrow();
});

test("a linked clone captures only under a running shared record", () => {
  const { repo, store } = clone();
  symlinkSync(store, join(repo, ".screenshots"));
  expect(() => assertSharedCaptureRecorded(repo)).toThrow(
    "capture through its `artifacts capture`",
  );
  for (const status of ["complete", "failed"]) {
    record(store, status);
    expect(() => assertSharedCaptureRecorded(repo), status).toThrow(
      "shared screenshot store",
    );
  }
  record(store, "running");
  expect(() => assertSharedCaptureRecorded(repo)).not.toThrow();
});
