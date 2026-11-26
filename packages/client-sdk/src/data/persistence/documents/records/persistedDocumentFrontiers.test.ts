import { expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../../../sqlite/schema/documentRecordSchema";
import { ensureSqlTables } from "../../../sqlite/sqlSchema";
import { readPersistedDocumentFrontiers } from "./persistedDocumentFrontiers";

test("persisted frontiers are read by local id within one app kind", async () => {
  const { close, execSql } = await createTestExecSql("persisted-frontiers");
  const frontier = encodeVersionVectorCounters({ "7": 4 });
  const behind = encodeVersionVectorCounters({ "7": 2 });
  try {
    await ensureSqlTables(execSql, documentTables);
    const rows: ReadonlyArray<readonly [string, string, string]> = [
      ["documents", "a", frontier],
      ["documents", "b", behind],
      ["container-metadata", "a", behind],
    ];
    for (const [appKind, localId, version] of rows) {
      await execSql(
        `INSERT INTO documents (app_kind, local_id, snapshot_end_version, updated_at)
         VALUES (?, ?, ?, '2026-11-25T00:00:00.000Z')`,
        [appKind, localId, version],
      );
    }

    expect(
      await readPersistedDocumentFrontiers(execSql, "documents", [
        "a",
        "b",
        "missing",
      ]),
    ).toEqual(
      new Map([
        ["a", frontier],
        ["b", behind],
      ]),
    );
    expect(
      await readPersistedDocumentFrontiers(execSql, "documents", []),
    ).toEqual(new Map());
  } finally {
    close();
  }
});
