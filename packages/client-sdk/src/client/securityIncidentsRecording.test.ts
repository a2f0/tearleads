import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { SecurityIncidentContext } from "../data/securityIncidents";
import type {
  ExecSql,
  SqlArrayRow,
  SqlBind,
  SqlRow,
  SqlRowMode,
} from "../data/sqlite/sqlSchema";
import { Database } from "./database";
import { createSecurityIncidentService } from "./securityIncidents";

test("record reports whether the incident reached durable storage", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-record-status",
  );
  let failInserts = true;
  async function failingExecSql(
    sql: string,
    bind?: SqlBind,
    options?: { rowMode?: SqlRowMode },
  ): Promise<Array<SqlRow | SqlArrayRow>> {
    if (
      failInserts &&
      sql.toLowerCase().includes('insert into "security_incidents"')
    ) {
      throw new Error("disk I/O error");
    }
    return execSql(sql, bind, options);
  }
  const logMessages: Array<string | Error> = [];
  const service = createSecurityIncidentService({
    database: new Database({
      execSql: failingExecSql as ExecSql,
      status: "ready",
    }),
    logError: (message) => logMessages.push(message),
    trustDomain: null,
  });
  const context: SecurityIncidentContext = {
    objectId: "document-1",
    objectKind: "document",
    operation: "backup.restore",
  };

  try {
    const buffered = new KeyingVerificationError("equivocation", "secret");
    expect(await service.incidents.record(buffered, context)).toBe("buffered");
    expect(logMessages).toEqual(["Security incident could not be persisted"]);
    // The same error instance is not written twice; it keeps its status.
    expect(await service.incidents.record(buffered, context)).toBe("buffered");
    expect(logMessages).toHaveLength(1);

    failInserts = false;
    expect(
      await service.incidents.record(
        new KeyingVerificationError("equivocation", "secret"),
        { ...context, objectId: "document-2" },
      ),
    ).toBe("recorded");

    service.dispose();
    expect(
      await service.incidents.record(
        new KeyingVerificationError("equivocation", "secret"),
        { ...context, objectId: "document-3" },
      ),
    ).toBe("failed");
  } finally {
    service.dispose();
    await close();
  }
});
