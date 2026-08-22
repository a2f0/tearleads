import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { accessManifestHeads } from "@symcrypt/api-shared/schema";
import {
  lockAccessManifestHeadsForShare,
  lockAccessManifestHeadsForUpdate,
} from "./accessManifestStore";

// True sync-vs-rekey serialization cannot be reproduced here: the test backend
// is single-connection pglite, so two transactions never run concurrently.
// These tests pin the helper wiring and dialect-specific lock statements; the
// mutation lock-plan test simulates contention and verifies acquisition order.

test("lockAccessManifestHeadsForShare no-ops for empty object ids", async () => {
  expect(
    await db.transaction((tx) =>
      lockAccessManifestHeadsForShare("container", [], tx),
    ),
  ).toEqual([]);
});

test("lockAccessManifestHeadsForShare returns every locked head", async () => {
  const objectIds = [crypto.randomUUID(), crypto.randomUUID()].sort();
  const organizationId = crypto.randomUUID();
  await db.insert(accessManifestHeads).values(
    objectIds.map((objectId) => ({
      epoch: 1,
      manifestHash: `manifest:${objectId}`,
      objectId,
      objectKind: "container" as const,
      organizationId,
    })),
  );
  expect(
    await db.transaction((tx) =>
      lockAccessManifestHeadsForShare("container", objectIds, tx),
    ),
  ).toEqual(objectIds);
});

test("lockAccessManifestHeadsForShare returns no absent heads", async () => {
  // No head rows match these ids, so it locks nothing, but it still executes the
  // dialect-specific FOR SHARE statement against the real (pglite) backend.
  expect(
    await db.transaction((tx) =>
      lockAccessManifestHeadsForShare(
        "container",
        [crypto.randomUUID(), crypto.randomUUID()],
        tx,
      ),
    ),
  ).toEqual([]);
});

test("lockAccessManifestHeadsForUpdate runs the document FOR UPDATE lock", async () => {
  await db.transaction((tx) =>
    lockAccessManifestHeadsForUpdate("document", [crypto.randomUUID()], tx),
  );
  expect(true).toBe(true);
});
