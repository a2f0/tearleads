import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { sql } from "drizzle-orm";
import { getClientSQLitePersistenceRuntime } from "../data/sqlite/sqlitePersistenceRuntime";
import type {
  ExecSql,
  SqlArrayRow,
  SqlBind,
  SqlRow,
  SqlRowMode,
} from "../data/sqlite/sqlSchema";
import { Database } from "./database";
import { createSecurityIncidentService } from "./securityIncidents";

test("incident appends serialize behind another persistence transaction", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-serialized-append",
  );
  const service = createSecurityIncidentService({
    database: new Database({ execSql, status: "ready" }),
    logError: () => undefined,
    trustDomain: null,
  });
  await service.incidents.list();
  let releaseMutation: (() => void) | undefined;
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });
  let markMutationStarted: (() => void) | undefined;
  const mutationStarted = new Promise<void>((resolve) => {
    markMutationStarted = resolve;
  });
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const mutation = runtime.transaction(async (tx) => {
    await tx.run(
      sql`CREATE TABLE "incident_race_probe" ("id" TEXT PRIMARY KEY)`,
    );
    await tx.run(sql`INSERT INTO "incident_race_probe" ("id") VALUES ('a')`);
    markMutationStarted?.();
    await mutationGate;
    await tx.run(sql`INSERT INTO "incident_race_probe" ("id") VALUES ('b')`);
  });

  try {
    await mutationStarted;
    let reportSettled = false;
    const report = service
      .report(new KeyingVerificationError("rollback", "stale head"), {
        objectId: "principal-serialized",
        objectKind: "principal",
        operation: "principal.policy.verify",
      })
      .then(() => {
        reportSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(reportSettled).toBe(false);

    releaseMutation?.();
    await Promise.all([mutation, report]);
    expect(
      await execSql('SELECT "id" FROM "incident_race_probe" ORDER BY "id"'),
    ).toEqual([{ id: "a" }, { id: "b" }]);
    expect(await service.incidents.list()).toEqual([
      expect.objectContaining({ objectId: "principal-serialized" }),
    ]);
  } finally {
    releaseMutation?.();
    service.dispose();
    await close();
  }
});

test("disposing the incident service cancels a pending append retry", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-disposed-retry",
  );
  let insertAttempts = 0;
  let markInsertStarted: (() => void) | undefined;
  const insertStarted = new Promise<void>((resolve) => {
    markInsertStarted = resolve;
  });
  let releaseInsert: (() => void) | undefined;
  const insertGate = new Promise<void>((resolve) => {
    releaseInsert = resolve;
  });
  async function failingExecSql(
    sqlText: string,
    bind?: SqlBind,
    options?: { rowMode?: SqlRowMode },
  ): Promise<Array<SqlRow | SqlArrayRow>> {
    if (sqlText.toLowerCase().includes('insert into "security_incidents"')) {
      insertAttempts += 1;
      markInsertStarted?.();
      await insertGate;
      throw new Error("persistent SQLite failure");
    }
    return execSql(sqlText, bind, options);
  }
  const service = createSecurityIncidentService({
    database: new Database({
      execSql: failingExecSql as ExecSql,
      status: "ready",
    }),
    logError: () => undefined,
    trustDomain: null,
  });

  try {
    const report = service.report(
      new KeyingVerificationError("rollback", "stale head"),
      {
        objectId: "principal-disposed",
        objectKind: "principal",
        operation: "principal.policy.verify",
      },
    );
    await insertStarted;
    expect(insertAttempts).toBe(1);
    service.dispose();
    releaseInsert?.();
    await report;
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(insertAttempts).toBe(1);
  } finally {
    releaseInsert?.();
    service.dispose();
    await close();
  }
});
