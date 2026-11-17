import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import { createClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type {
  ExecSql,
  SqlArrayRow,
  SqlRow,
} from "../../../data/sqlite/sqlSchema";
import { listContainerMetadataRevalidations } from "../../../workflows/container-contents/metadata/metadataRevalidation";
import {
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
    runtime: { infra: { execSql } },
  } as Parameters<typeof oweContainerMetadataRead>[0];
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

test("an owed metadata read survives a restart until a read pays it", async () => {
  const { close, execSql } = await openDatabase();
  try {
    const before = storeState(execSql);
    await oweContainerMetadataRead(before, "metadata-1");
    expect([...before.metadataDocumentIdsNeedingSync]).toEqual(["metadata-1"]);
    expect(before.metadataSyncSignalSeqById.get("metadata-1")).toBe(1);

    // A new process starts with empty memory and requeues the debt.
    const after = storeState(execSql);
    expect(await restoreOwedContainerMetadataReads(after)).toBe(1);
    expect([...after.metadataDocumentIdsNeedingSync]).toEqual(["metadata-1"]);
    expect(after.metadataSyncSignalSeqById.get("metadata-1")).toBe(1);

    // A read that finished while the document is still queued, because a
    // newer signal arrived during it, leaves the debt in place.
    await settleOwedContainerMetadataRead(after, {
      documentId: "metadata-1",
      execSql,
    });
    expect(await listContainerMetadataRevalidations(execSql)).toEqual([
      "metadata-1",
    ]);

    after.metadataDocumentIdsNeedingSync.delete("metadata-1");
    await settleOwedContainerMetadataRead(after, {
      documentId: "metadata-1",
      execSql,
    });
    expect(await listContainerMetadataRevalidations(execSql)).toEqual([]);
    expect(await restoreOwedContainerMetadataReads(storeState(execSql))).toBe(
      0,
    );
  } finally {
    close();
  }
});

test("startup drops a debt for a container it no longer holds", async () => {
  const { close, execSql } = await openDatabase();
  try {
    await oweContainerMetadataRead(storeState(execSql), "metadata-1");
    await oweContainerMetadataRead(storeState(execSql), "metadata-gone");
    const after = storeState(execSql);
    expect(await restoreOwedContainerMetadataReads(after)).toBe(1);
    expect([...after.metadataDocumentIdsNeedingSync]).toEqual(["metadata-1"]);
    expect(await listContainerMetadataRevalidations(execSql)).toEqual([
      "metadata-1",
    ]);
  } finally {
    close();
  }
});
