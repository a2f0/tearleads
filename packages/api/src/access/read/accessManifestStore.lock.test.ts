import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { lockAccessManifestHeadsForShare } from "./accessManifestStore";

// True sync-vs-rekey serialization cannot be reproduced here: the test backend
// is single-connection pglite, so two transactions never run concurrently.
// These tests pin the helper's wiring and that the dialect-specific FOR SHARE
// statement is valid against the real backend; the locking behavior itself is
// exercised end-to-end by the document-sync and blob-bind write-path tests.

test("lockAccessManifestHeadsForShare no-ops for empty object ids", async () => {
  await db.transaction((tx) =>
    lockAccessManifestHeadsForShare("container", [], tx),
  );
  expect(true).toBe(true);
});

test("lockAccessManifestHeadsForShare runs the FOR SHARE lock without error", async () => {
  // No head rows match these ids, so it locks nothing, but it still executes the
  // dialect-specific FOR SHARE statement against the real (pglite) backend.
  await db.transaction((tx) =>
    lockAccessManifestHeadsForShare(
      "container",
      [crypto.randomUUID(), crypto.randomUUID()],
      tx,
    ),
  );
  expect(true).toBe(true);
});
