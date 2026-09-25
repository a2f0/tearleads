import { expect, test } from "bun:test";
import {
  clientSQLiteSchema,
  defineSqlTableSchema,
} from "@tearleads/client-sdk/sqlite";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { securityAnchorBackupColumns } from "./securityAnchorBackupMerge";

// The anchor lists are the required subset a restore demands on both sides.
// They must track the SDK schema exactly: a column missing here would let a
// backup drop it silently, and a column that no longer exists would refuse
// every restore.
test("anchor column lists match the SDK SQLite schema for every anchor table", async () => {
  const database = createNativeTestExecSql();
  try {
    const schemas = new Map(
      Object.values(clientSQLiteSchema).map((table) => {
        const schema = defineSqlTableSchema(table);
        return [schema.name, schema] as const;
      }),
    );
    expect(securityAnchorBackupColumns.size).toBe(6);
    for (const [tableName, anchorColumns] of securityAnchorBackupColumns) {
      const schema = schemas.get(tableName);
      if (!schema) throw new Error(`SDK schema has no table ${tableName}`);
      await database.execSql(schema.createSql);
      const columns = (
        await database.execSql(`PRAGMA table_info("${tableName}")`)
      ).map(({ name }) => String(name));
      expect([...anchorColumns].sort()).toEqual([...columns].sort());
      expect(new Set(anchorColumns).size).toBe(anchorColumns.length);
    }
  } finally {
    database.close();
  }
});
