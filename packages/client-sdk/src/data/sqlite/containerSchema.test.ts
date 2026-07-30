import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { containerTables } from "./schema";
import { ensureSqlTables } from "./sqlSchema";

test("dormant sweep schema persists bounded retry state", async () => {
  const { close, execSql } = await createTestExecSql(
    "dormant-metadata-sweep-schema",
  );
  try {
    await ensureSqlTables(execSql, containerTables);
    const rows = await execSql(
      "PRAGMA table_info(dormant_metadata_sweep_requests)",
    );
    const attemptCount = rows.find(
      (row) => Reflect.get(row, "name") === "attempt_count",
    );
    const lastAttemptedAt = rows.find(
      (row) => Reflect.get(row, "name") === "last_attempted_at",
    );

    expect(attemptCount).toMatchObject({
      dflt_value: "0",
      notnull: 1,
      type: "INTEGER",
    });
    expect(lastAttemptedAt).toMatchObject({
      dflt_value: null,
      notnull: 0,
      type: "TEXT",
    });
  } finally {
    await close();
  }
});
