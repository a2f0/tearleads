import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { captureStatements } from "../../../../test/helpers/statementCapture";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import { SQLITE_BOUND_VARIABLE_BUDGET } from "../../sqlite/sqliteBindBudget";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ContainerDocumentTombstoneHoldRepository } from "./containerDocumentTombstoneHoldRepository";
import type { HeldContainerDocumentTombstone } from "./containerDocumentTombstoneHoldsPersistence";
import { sqlDocumentsPersistence } from "./documentsPersistence";

const repository = (execSql: ExecSql) =>
  new ContainerDocumentTombstoneHoldRepository(execSql);
const repositoryAt = (execSql: ExecSql, instant: string | Date) =>
  new ContainerDocumentTombstoneHoldRepository(
    execSql,
    () => new Date(instant),
  );

const now = "2026-01-01T00:00:00.000Z";
const later = "2026-01-02T00:00:00.000Z";
for (const size of [166, 167, 1001]) {
  test(`hold writes keep ${size} rows within the bind budget`, async () => {
    const db = await createTestExecSql("hold-batch-boundary");
    const { execSql, statements } = captureStatements(db.execSql);
    const inputs = Array.from({ length: size }, (_, i) => ({
      containerId: "container",
      documentId: `document-${String(i).padStart(4, "0")}`,
      updatedAt: now,
    }));
    try {
      // Keep schema setup outside the measured operation.
      await sqlDocumentsPersistence.ensureSchema(execSql);
      statements.length = 0;
      await repositoryAt(execSql, later).holdContainerDocumentTombstones(
        inputs,
      );
      const writes = statements.filter(({ sql }) =>
        /^insert into "container_document_tombstone_holds"/i.test(sql),
      );
      console.info(
        JSON.stringify({
          operation: "hold-boundary",
          size,
          statements: statements.length,
          writeBinds: writes.map((row) => row.binds),
        }),
      );
      expect(writes).toHaveLength(Math.ceil(size / 166));
      expect(
        Math.max(...statements.map((row) => row.binds)),
      ).toBeLessThanOrEqual(SQLITE_BOUND_VARIABLE_BUDGET);
      expect(statements.filter(({ sql }) => /^begin/i.test(sql))).toHaveLength(
        1,
      );
      expect(statements.filter(({ sql }) => /^commit/i.test(sql))).toHaveLength(
        1,
      );
      expect(
        await repository(db.execSql).listContainerDocumentTombstoneHolds([
          "container",
        ]),
      ).toEqual(
        inputs.map((row) => ({
          ...row,
          attempts: 1,
          hidden: true,
          tombstonedAt: now,
          updatedAt: later,
        })),
      );
    } finally {
      await db.close();
    }
  });
}

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
    await repositoryAt(counted.execSql, now).holdContainerDocumentTombstones(
      holds.slice(0, 1),
    );
    expect(
      await counted.count(() =>
        repositoryAt(counted.execSql, now).holdContainerDocumentTombstones(
          holds,
        ),
      ),
    ).toBe(4);
    expect(
      await repository(db.execSql).listContainerDocumentTombstoneHolds([
        "container",
      ]),
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
    await repositoryAt(counted.execSql, now).holdContainerDocumentTombstones([
      ...placements,
      untouched,
    ]);
    expect(
      await counted.count(() =>
        repository(counted.execSql).refuteContainerDocumentTombstoneHolds(
          placements,
        ),
      ),
    ).toBe(4);
    const rows = await repository(
      db.execSql,
    ).listContainerDocumentTombstoneHolds(
      placements.map((row) => row.containerId),
    );
    expect(rows.filter((row) => row.hidden)).toEqual([
      { ...untouched, attempts: 1, hidden: true, tombstonedAt: now },
    ]);
    expect(
      await counted.count(() =>
        repository(counted.execSql).refuteContainerDocumentTombstoneHolds([]),
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
    await repositoryAt(batched.execSql, later).holdContainerDocumentTombstones(
      mixed,
    );
    for (const hold of mixed)
      await repositoryAt(single.execSql, later).holdContainerDocumentTombstones(
        [hold],
      );
    const rows = await repository(
      batched.execSql,
    ).listContainerDocumentTombstoneHolds(["container"]);
    expect(rows).toEqual(
      await repository(single.execSql).listContainerDocumentTombstoneHolds([
        "container",
      ]),
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
