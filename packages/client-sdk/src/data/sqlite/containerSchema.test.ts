import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  readTableColumns,
  requireColumn,
} from "../../../test/helpers/sqlitePragma";
import { containerTables } from "./schema";
import { ensureSqlTables } from "./sqlSchema";

test("dormant sweep schema persists bounded retry state", async () => {
  const { close, execSql } = await createTestExecSql(
    "dormant-metadata-sweep-schema",
  );
  try {
    await ensureSqlTables(execSql, containerTables);
    const columns = await readTableColumns(
      execSql,
      "dormant_metadata_sweep_requests",
    );

    expect(requireColumn(columns, "attempt_count")).toMatchObject({
      defaultValue: "0",
      notNull: 1,
      type: "INTEGER",
    });
    expect(requireColumn(columns, "last_attempted_at")).toMatchObject({
      defaultValue: null,
      notNull: 0,
      type: "TEXT",
    });
  } finally {
    await close();
  }
});

test("container schema includes durable hydration tombstones", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-tombstone-schema",
  );
  try {
    await ensureSqlTables(execSql, containerTables);
    const columns = await readTableColumns(
      execSql,
      "container_hydration_tombstones",
    );
    expect(requireColumn(columns, "container_id").pk).toBe(1);
    expect(requireColumn(columns, "generation")).toMatchObject({
      defaultValue: "1",
      notNull: 1,
      type: "INTEGER",
    });
    expect(requireColumn(columns, "cleared")).toMatchObject({
      defaultValue: "0",
      notNull: 1,
      type: "INTEGER",
    });
    expect(requireColumn(columns, "reason").notNull).toBe(1);
    expect(requireColumn(columns, "updated_at").notNull).toBe(1);
  } finally {
    await close();
  }
});

test("obsolete hydration fences require a database reset", async () => {
  const { close, execSql } = await createTestExecSql(
    "obsolete-hydration-fence",
  );
  try {
    await execSql(`CREATE TABLE container_hydration_tombstones (
      container_id TEXT PRIMARY KEY NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      reason TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await expect(ensureSqlTables(execSql, containerTables)).rejects.toThrow(
      "reset the local database",
    );
  } finally {
    await close();
  }
});
