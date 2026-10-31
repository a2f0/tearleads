import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { accessManifestHeads } from "@tearleads/api-shared/schema";
import {
  lockAccessManifestHeadsForShare,
  lockAccessManifestHeadsForUpdate,
  lockUnheldAccessManifestHeads,
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

test("lockUnheldAccessManifestHeads skips heads the transaction already holds", async () => {
  const objectIds = [crypto.randomUUID(), crypto.randomUUID()].sort();
  const [first, second] = objectIds;
  if (!first || !second) throw new Error("Expected two ids");
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
  await db.transaction(async (tx) => {
    const count = async <T>(work: () => Promise<T>) => {
      const counter = { statements: 0 };
      const result = await withDatabaseStatementCounter(counter, work);
      return { result, statements: counter.statements };
    };
    await lockAccessManifestHeadsForShare("container", [first], tx);

    // Only the unheld head is locked, and its row is returned.
    const shared = await count(() =>
      lockUnheldAccessManifestHeads("container", objectIds, tx, "share"),
    );
    expect(shared.statements).toBe(1);
    expect([...shared.result.keys()]).toEqual([second]);
    expect(shared.result.get(second)).toMatchObject({
      manifestHash: `manifest:${second}`,
      objectId: second,
    });
    const again = await count(() =>
      lockUnheldAccessManifestHeads("container", objectIds, tx, "share"),
    );
    expect(again.statements).toBe(0);
    // A share lock does not cover an update lock.
    const update = await count(() =>
      lockUnheldAccessManifestHeads("container", [first], tx, "update"),
    );
    expect(update.statements).toBe(1);
  });
  // A new transaction holds nothing.
  await db.transaction(async (tx) => {
    const counter = { statements: 0 };
    await withDatabaseStatementCounter(counter, () =>
      lockUnheldAccessManifestHeads("container", objectIds, tx, "share"),
    );
    expect(counter.statements).toBe(1);
  });
});
