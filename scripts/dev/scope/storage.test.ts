import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { blobName, safeArchiveEntry, selectToolEvents } from "./storage";

test("offline storage helpers do not load API registration or validate its environment", () => {
  execFileSync(process.execPath, ["-e", "await import('./storage.ts')"], {
    cwd: import.meta.dir,
    env: { ...process.env, SCOPE_API_URL: "https://not-a-local-api.invalid" },
    stdio: "pipe",
  });
});

test("snapshot paths reject traversal, absolute paths and links", () => {
  for (const path of [
    "../outside",
    "/tmp/outside",
    "a/../../outside",
    "C:/outside",
    "..\\outside",
  ]) {
    assert.equal(safeArchiveEntry(path, "File"), false, path);
  }
  for (const type of ["SymbolicLink", "Link", "CharacterDevice", "FIFO"]) {
    assert.equal(safeArchiveEntry("innocent", type), false, type);
  }
  assert.equal(safeArchiveEntry("./packages/api/index.ts", "File"), true);
  assert.equal(safeArchiveEntry("packages/api/", "Directory"), true);
});

test("artifact downloads accept only the local snapshots container", () => {
  assert.equal(
    blobName(
      "http://127.0.0.1:10101/devstoreaccount1/snapshots/run/workspace.tar.gz",
    ),
    "run/workspace.tar.gz",
  );
  for (const url of [
    "https://example.com/file",
    "http://127.0.0.1:10101/another/file",
    "http://secret@127.0.0.1:10101/devstoreaccount1/snapshots/file",
    "http://127.0.0.1:10101/devstoreaccount1/snapshots/file?token=secret",
    "http://127.0.0.1:10101/devstoreaccount1/snapshots/..%2Flogs%2Fprobe",
    "http://127.0.0.1:10101/devstoreaccount1/snapshots/a%2F..%2Fprobe",
    "http://127.0.0.1:10101/devstoreaccount1/snapshots/a%2F%2Fprobe",
    "http://127.0.0.1:10101/devstoreaccount1/snapshots/a%5Cprobe",
  ]) {
    assert.throws(() => blobName(url));
  }
});

test("Judge replay receives observed tool errors without old verdicts or prior turns", () => {
  const observed = {
    message: "Tool update: Terminal mise config not trusted",
    data: { iteration: 2 },
  };
  assert.deepEqual(
    selectToolEvents(
      [
        observed,
        { ...observed, data: { iteration: 1 } },
        { message: "Judge passed all criteria", data: { iteration: 2 } },
        { message: "Tool update: Terminal", data: null },
        null,
      ],
      2,
    ),
    [observed],
  );
});
