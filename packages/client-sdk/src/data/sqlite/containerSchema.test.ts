import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
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
    expect(requireColumn(columns, "reason").notNull).toBe(1);
    expect(requireColumn(columns, "updated_at").notNull).toBe(1);
  } finally {
    await close();
  }
});
