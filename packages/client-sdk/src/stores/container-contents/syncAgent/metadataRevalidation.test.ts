import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import { createClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type {
  ExecSql,
  SqlArrayRow,
  SqlRow,
} from "../../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence as persistence } from "../../../workflows/container-contents/containerPersistence";
import {
  findOwedContainerMetadataRead,
  oweContainerMetadataRead,
  restoreOwedContainerMetadataReads,
  settleOwedContainerMetadataRead,
} from "./metadataRevalidation";

/** The parts of the store state this module reads, over one database. */
function storeState(execSql: ExecSql, heldDocumentIds = ["metadata-1"]) {
  return {
    containersById: new Map(
      heldDocumentIds.map((documentId) => [
        documentId,
        { record: { documentId } },
      ]),
    ),
    metadataDocumentIdsNeedingSync: new Set<string>(),
    metadataSyncSignalSeqById: new Map<string, number>(),
    persistence,
    runtime: { infra: { execSql } },
  } as unknown as Parameters<typeof oweContainerMetadataRead>[0];
}

async function openDatabase() {
  const db = await initTestSqliteDatabase({
    cipher: "chacha20",
    dbName: `/${crypto.randomUUID()}.db`,
    key: "owed-metadata-reads",
  });
  return {
    close: () => db.close(),
    execSql: createClientSQLitePersistenceRuntime({
      exec: async (options) => ({
        rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
      }),
    }).execSql,
  };
}

async function owedDocumentIds(execSql: ExecSql) {
  return (await persistence.listContainerMetadataRevalidations(execSql)).map(
    ({ documentId }) => documentId,
  );
}

test("an owed metadata read survives a restart until a read pays it", async () => {
  const { close, execSql } = await openDatabase();
  try {
    const before = storeState(execSql);
    await oweContainerMetadataRead(before, "metadata-1");
    expect([...before.metadataDocumentIdsNeedingSync]).toEqual(["metadata-1"]);
    expect(before.metadataSyncSignalSeqById.get("metadata-1")).toBe(1);

    // A new process starts with empty memory and requeues the debt.
    const after = storeState(execSql);
    expect(await restoreOwedContainerMetadataReads(after, () => true)).toBe(1);
    expect([...after.metadataDocumentIdsNeedingSync]).toEqual(["metadata-1"]);
    const owed = await findOwedContainerMetadataRead(after, {
      documentId: "metadata-1",
      execSql,
    });
    if (!owed) throw new Error("Expected the owed read");

    // A read that finished while the document is still queued, because a
    // newer signal arrived during it, leaves the debt in place.
    await settleOwedContainerMetadataRead(after, {
      execSql,
      revalidation: owed,
    });
    expect(await owedDocumentIds(execSql)).toEqual(["metadata-1"]);

    after.metadataDocumentIdsNeedingSync.delete("metadata-1");
    await settleOwedContainerMetadataRead(after, {
      execSql,
      revalidation: owed,
    });
    expect(await owedDocumentIds(execSql)).toEqual([]);
    expect(
      await restoreOwedContainerMetadataReads(storeState(execSql), () => true),
    ).toBe(0);
  } finally {
    close();
  }
});

test("a read settles only the request it saw, not a newer one from another tab", async () => {
  const { close, execSql } = await openDatabase();
  try {
    const reader = storeState(execSql);
    await oweContainerMetadataRead(reader, "metadata-1");
    const seen = await findOwedContainerMetadataRead(reader, {
      documentId: "metadata-1",
      execSql,
    });
    if (!seen) throw new Error("Expected the owed read");
    // Another tab sharing the database owes the read again meanwhile.
    await oweContainerMetadataRead(storeState(execSql), "metadata-1");

    reader.metadataDocumentIdsNeedingSync.delete("metadata-1");
    await settleOwedContainerMetadataRead(reader, {
      execSql,
      revalidation: seen,
    });
    expect(await owedDocumentIds(execSql)).toEqual(["metadata-1"]);
  } finally {
    close();
  }
});

test("startup leaves a debt for a container this tab does not hold", async () => {
  const { close, execSql } = await openDatabase();
  try {
    await oweContainerMetadataRead(storeState(execSql), "metadata-1");
    await oweContainerMetadataRead(storeState(execSql), "metadata-gone");
    const after = storeState(execSql);
    expect(await restoreOwedContainerMetadataReads(after, () => true)).toBe(1);
    expect([...after.metadataDocumentIdsNeedingSync]).toEqual(["metadata-1"]);
    // Another tab sharing the database may hold it and still owe the read.
    expect(await owedDocumentIds(execSql)).toEqual([
      "metadata-1",
      "metadata-gone",
    ]);
  } finally {
    close();
  }
});

test("a restore that a store replacement overtakes queues nothing", async () => {
  const { close, execSql } = await openDatabase();
  try {
    await oweContainerMetadataRead(storeState(execSql), "metadata-1");
    const stale = storeState(execSql);
    expect(await restoreOwedContainerMetadataReads(stale, () => false)).toBe(0);
    expect([...stale.metadataDocumentIdsNeedingSync]).toEqual([]);
    expect(await owedDocumentIds(execSql)).toEqual(["metadata-1"]);
  } finally {
    close();
  }
});
