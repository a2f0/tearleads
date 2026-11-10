import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import {
  type HeldContainerDocumentTombstone,
  holdContainerDocumentTombstones,
  listContainerDocumentTombstoneHolds,
  refuteContainerDocumentTombstoneHolds,
} from "./containerDocumentTombstoneHoldsPersistence";
import { sqlDocumentsPersistence } from "./documentsPersistence";

const now = "2026-01-01T00:00:00.000Z";
const later = "2026-01-02T00:00:00.000Z";
const holds = Array.from({ length: 32 }, (_, i) => ({
  containerId: "container",
  documentId: `document-${i}`,
  updatedAt: now,
}));

test("hold writes use one bounded statement per attempt mode", async () => {
  const db = await createTestExecSql("hold-set-budget");
  const counted = countingExecSql(db.execSql);
  try {
    await sqlDocumentsPersistence.ensureSchema(counted.execSql);
    // Warm the projection-table ensure separately from the measured operation.
    await holdContainerDocumentTombstones(
      counted.execSql,
      holds.slice(0, 1),
      now,
    );
    expect(
      await counted.count(() =>
        holdContainerDocumentTombstones(counted.execSql, holds, now),
      ),
    ).toBe(4);
    expect(
      await listContainerDocumentTombstoneHolds(db.execSql, ["container"]),
    ).toHaveLength(32);
  } finally {
    await db.close();
  }
});

test("refuting holds updates only the named pairs in bounded batches", async () => {
  const db = await createTestExecSql("hold-refute-budget");
  const counted = countingExecSql(db.execSql);
  const placements = Array.from({ length: 51 }, (_, i) => ({
    containerId: `container-${i}`,
    documentId: `document-${i}`,
    updatedAt: now,
  }));
  const untouched = {
    containerId: "container-0",
    documentId: "document-1",
    updatedAt: now,
  };
  try {
    await sqlDocumentsPersistence.ensureSchema(counted.execSql);
    await holdContainerDocumentTombstones(
      counted.execSql,
      [...placements, untouched],
      now,
    );
    expect(
      await counted.count(() =>
        refuteContainerDocumentTombstoneHolds(counted.execSql, placements),
      ),
    ).toBe(4);
    const rows = await listContainerDocumentTombstoneHolds(
      db.execSql,
      placements.map((row) => row.containerId),
    );
    expect(rows.filter((row) => row.hidden)).toEqual([
      { ...untouched, attempts: 1, hidden: true, tombstonedAt: now },
    ]);
    expect(
      await counted.count(() =>
        refuteContainerDocumentTombstoneHolds(counted.execSql, []),
      ),
    ).toBe(0);
  } finally {
    await db.close();
  }
});

test("mixed deferred holds preserve sequential conflict semantics", async () => {
  const batched = await createTestExecSql("hold-set-mixed");
  const single = await createTestExecSql("hold-single-mixed");
  const first = holds[0];
  if (!first) throw new Error("Missing hold fixture");
  const mixed: HeldContainerDocumentTombstone[] = [
    { ...first, deferred: true },
    ...holds,
    { ...first, refuted: true, updatedAt: later },
    { ...first, deferred: true, updatedAt: now },
    { ...first, updatedAt: later },
  ];
  try {
    for (const db of [batched, single])
      await sqlDocumentsPersistence.ensureSchema(db.execSql);
    await holdContainerDocumentTombstones(batched.execSql, mixed, later);
    for (const hold of mixed)
      await holdContainerDocumentTombstones(single.execSql, [hold], later);
    const rows = await listContainerDocumentTombstoneHolds(batched.execSql, [
      "container",
    ]);
    expect(rows).toEqual(
      await listContainerDocumentTombstoneHolds(single.execSql, ["container"]),
    );
    expect(
      rows.find((row) => row.documentId === first.documentId),
    ).toMatchObject({
      attempts: 3,
      hidden: false,
      tombstonedAt: later,
      updatedAt: later,
    });
  } finally {
    await batched.close();
    await single.close();
  }
});
