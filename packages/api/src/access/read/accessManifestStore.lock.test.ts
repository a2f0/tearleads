import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  lockAccessManifestHeadsForShare,
  lockAccessManifestHeadsForUpdate,
} from "./accessManifestStore";

// True sync-vs-rekey serialization cannot be reproduced here: the test backend
// is single-connection pglite, so two transactions never run concurrently.
// These tests pin the helper wiring and dialect-specific lock statements; the
// mutation lock-plan test simulates contention and verifies acquisition order.

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

test("lockAccessManifestHeadsForUpdate runs the document FOR UPDATE lock", async () => {
  await db.transaction((tx) =>
    lockAccessManifestHeadsForUpdate("document", [crypto.randomUUID()], tx),
  );
  expect(true).toBe(true);
});
