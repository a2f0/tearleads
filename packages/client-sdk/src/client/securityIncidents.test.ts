import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  reportAndRethrowKeyingVerificationError,
  throwKeyingVerificationErrorWithContext,
} from "../data/keyingProjectionVerification/error";
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

test("security incidents are durable, redacted, and emitted once", async () => {
  const { close, execSql } = await createTestExecSql("security-incidents");
  const database = new Database({
    execSql,
    id: "security-incidents",
    status: "ready",
  });
  const callbacks: string[] = [];
  const subscriptions: string[] = [];
  const service = createSecurityIncidentService({
    database,
    logError: () => undefined,
    onIncident: (incident) => callbacks.push(incident.id),
    trustDomain: "https://api.example.test",
  });
  service.incidents.subscribe((incident) => subscriptions.push(incident.id));
  const error = new KeyingVerificationError("signature_mismatch", "secret");

  try {
    await service.report(error, {
      evidenceHashes: { manifestHash: "hash-1" },
      objectId: "document-1",
      objectKind: "document",
      operation: "document.sync",
      organizationId: "organization-1",
    });
    await service.report(error, {
      objectId: "document-1",
      objectKind: "document",
      operation: "document.sync",
    });

    const incidents = await service.incidents.list();
    expect(incidents).toHaveLength(1);
    const incident = incidents?.[0];
    if (!incident) throw new Error("Expected a persisted security incident");
    expect(incident).toMatchObject({
      code: "signature_mismatch",
      evidenceHashes: { manifestHash: "hash-1" },
      objectId: "document-1",
      objectKind: "document",
      operation: "document.sync",
      organizationId: "organization-1",
      trustDomain: "https://api.example.test",
    });
    expect(callbacks).toEqual([incident.id]);
    expect(subscriptions).toEqual([incident.id]);

    const rows = await execSql("SELECT * FROM security_incidents");
    expect(JSON.stringify(rows)).not.toContain(error.message);
  } finally {
    service.dispose();
    await close();
  }
});

test("ordinary failures are not security incidents", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-ordinary",
  );
  const database = new Database({ execSql, status: "ready" });
  const service = createSecurityIncidentService({
    database,
    logError: () => undefined,
    trustDomain: null,
  });

  try {
    await service.report(new Error("network unavailable"), {
      objectId: "document-1",
      objectKind: "document",
      operation: "document.sync",
    });
    expect(await service.incidents.list()).toEqual([]);
  } finally {
    service.dispose();
    await close();
  }
});

test("incidents detected before database startup flush when it becomes ready", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-startup-buffer",
  );
  const logMessages: Array<string | Error> = [];
  const database = new Database({ status: "idle" });
  const service = createSecurityIncidentService({
    database,
    logError: (message) => logMessages.push(message),
    trustDomain: null,
  });
  const error = new KeyingVerificationError("rollback", "secret stale head");

  try {
    await service.report(error, {
      objectId: "principal-1",
      objectKind: "principal",
      operation: "principal.policy.verify",
    });

    expect(await service.incidents.list()).toBeNull();
    database.setExecSql(execSql);
    const incidents = await service.incidents.list();
    expect(incidents).toHaveLength(1);
    expect(incidents?.[0]).toMatchObject({
      code: "rollback",
      objectId: "principal-1",
      occurrenceCount: 1,
    });
    expect(logMessages).toEqual([]);
    expect(
      JSON.stringify(await execSql("SELECT * FROM security_incidents")),
    ).not.toContain(error.message);
  } finally {
    service.dispose();
    await close();
  }
});

test("the startup incident buffer drops unique overflow safely", async () => {
  const logMessages: Array<string | Error> = [];
  const service = createSecurityIncidentService({
    database: new Database({ status: "idle" }),
    logError: (message) => logMessages.push(message),
    trustDomain: null,
  });

  for (let index = 0; index <= 100; index += 1) {
    await service.report(
      new KeyingVerificationError("rollback", `stale head ${index}`),
      {
        objectId: `principal-${index}`,
        objectKind: "principal",
        operation: "principal.policy.verify",
      },
    );
  }

  expect(logMessages).toEqual([
    "Security incident could not be buffered because the startup buffer is full",
  ]);
  expect(await service.incidents.list()).toBeNull();
  service.dispose();
});

test("a list joins an active flush and drains incidents buffered during it", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-overlapping-flush",
  );
  let releaseInsert: (() => void) | undefined;
  const insertGate = new Promise<void>((resolve) => {
    releaseInsert = resolve;
  });
  let markInsertStarted: (() => void) | undefined;
  const insertStarted = new Promise<void>((resolve) => {
    markInsertStarted = resolve;
  });
  let shouldDelayInsert = true;
  async function delayedExecSql(
    sql: string,
    bind?: SqlBind,
    options?: { rowMode?: SqlRowMode },
  ): Promise<Array<SqlRow | SqlArrayRow>> {
    if (
      shouldDelayInsert &&
      sql.toLowerCase().includes('insert into "security_incidents"')
    ) {
      shouldDelayInsert = false;
      markInsertStarted?.();
      await insertGate;
    }
    return execSql(sql, bind, options);
  }

  const database = new Database({ status: "idle" });
  const service = createSecurityIncidentService({
    database,
    logError: () => undefined,
    trustDomain: null,
  });
  const report = (objectId: string) =>
    service.report(new KeyingVerificationError("rollback", "stale head"), {
      objectId,
      objectKind: "principal",
      operation: "principal.policy.verify",
    });

  try {
    await report("principal-before-flush");
    database.setExecSql(delayedExecSql as ExecSql);
    await insertStarted;
    database.clear();
    await report("principal-during-flush");
    database.setExecSql(delayedExecSql as ExecSql);
    releaseInsert?.();

    const incidents = await service.incidents.list();
    expect(incidents?.map((incident) => incident.objectId).sort()).toEqual([
      "principal-before-flush",
      "principal-during-flush",
    ]);
  } finally {
    releaseInsert?.();
    service.dispose();
    await close();
  }
});

test("a transient ready-database append failure retries buffered evidence", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-transient-append",
  );
  let remainingInsertFailures = 2;
  async function flakyExecSql(
    sql: string,
    bind?: SqlBind,
    options?: { rowMode?: SqlRowMode },
  ): Promise<Array<SqlRow | SqlArrayRow>> {
    if (
      remainingInsertFailures > 0 &&
      sql.toLowerCase().includes('insert into "security_incidents"')
    ) {
      remainingInsertFailures -= 1;
      throw new Error("transient SQLite failure");
    }
    return execSql(sql, bind, options);
  }
  let markDelivered: (() => void) | undefined;
  const delivered = new Promise<void>((resolve) => {
    markDelivered = resolve;
  });
  const logMessages: Array<string | Error> = [];
  const service = createSecurityIncidentService({
    database: new Database({
      execSql: flakyExecSql as ExecSql,
      status: "ready",
    }),
    logError: (message) => logMessages.push(message),
    onIncident: () => markDelivered?.(),
    trustDomain: null,
  });
  let deliveryTimeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await service.report(
      new KeyingVerificationError("rollback", "stale head"),
      {
        objectId: "principal-retry",
        objectKind: "principal",
        operation: "principal.policy.verify",
      },
    );
    await Promise.race([
      delivered,
      new Promise<never>(
        (_, reject) =>
          (deliveryTimeout = setTimeout(
            () => reject(new Error("Timed out waiting for incident retry")),
            2_000,
          )),
      ),
    ]);

    expect(await service.incidents.list()).toEqual([
      expect.objectContaining({ objectId: "principal-retry" }),
    ]);
    expect(logMessages).toEqual([
      "Security incident could not be persisted",
      "Buffered security incident could not be persisted",
    ]);
  } finally {
    clearTimeout(deliveryTimeout);
    service.dispose();
    await close();
  }
});

test("equivalent retry failures coalesce into one counted incident", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-coalesced-retries",
  );
  const observed: SecurityIncidentContext[] = [];
  const service = createSecurityIncidentService({
    database: new Database({ execSql, status: "ready" }),
    logError: () => undefined,
    onIncident: (incident) => {
      observed.push({
        evidenceHashes: incident.evidenceHashes,
        objectId: incident.objectId,
        objectKind: incident.objectKind,
        operation: incident.operation,
        organizationId: incident.organizationId,
      });
    },
    trustDomain: "https://api.example.test",
  });
  const context: SecurityIncidentContext = {
    evidenceHashes: { manifestHash: "hash-1" },
    objectId: "document-1",
    objectKind: "document",
    operation: "document.sync",
    organizationId: "organization-1",
  };

  try {
    await service.report(
      new KeyingVerificationError("signature_mismatch", "first retry"),
      context,
    );
    await service.report(
      new KeyingVerificationError("signature_mismatch", "second retry"),
      context,
    );

    const incidents = await service.incidents.list();
    expect(incidents).toHaveLength(1);
    expect(incidents?.[0]).toMatchObject({
      occurrenceCount: 2,
      operation: "document.sync",
    });
    expect(incidents?.[0]?.lastDetectedAt).not.toBeUndefined();
    expect(observed).toHaveLength(2);
  } finally {
    service.dispose();
    await close();
  }
});
test("unknown verification codes are logged instead of silently dropped", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-unknown-code",
  );
  const logMessages: Array<string | Error> = [];
  const service = createSecurityIncidentService({
    database: new Database({ execSql, status: "ready" }),
    logError: (message) => logMessages.push(message),
    trustDomain: null,
  });
  const error = new Error("future diagnostic");
  error.name = "KeyingVerificationError";
  Reflect.set(error, "code", "future_code");

  try {
    await service.report(error, {
      objectId: null,
      objectKind: "unknown",
      operation: "future.operation",
    });
    await service.report(error, {
      objectId: null,
      objectKind: "unknown",
      operation: "future.operation",
    });
    expect(await service.incidents.list()).toEqual([
      expect.objectContaining({
        code: "unrecognized_verification_code",
        operation: "future.operation",
      }),
    ]);
    expect(logMessages).toEqual([
      "Security incident used the fallback code because its verification code is unrecognized",
    ]);
    await execSql(
      'UPDATE "security_incidents" SET "code" = \'retired_code\', "evidence_hashes" = \'not-json\', "object_kind" = \'future-kind\'',
    );
    expect(await service.incidents.list()).toEqual([
      expect.objectContaining({
        code: "unrecognized_verification_code",
        evidenceHashes: {},
        objectKind: "unknown",
      }),
    ]);
  } finally {
    service.dispose();
    await close();
  }
});

test("concurrent reports of the same error append once", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-concurrent",
  );
  const service = createSecurityIncidentService({
    database: new Database({ execSql, status: "ready" }),
    logError: () => undefined,
    trustDomain: null,
  });
  const error = new KeyingVerificationError("rollback", "stale head");
  const context: SecurityIncidentContext = {
    objectId: null,
    objectKind: "unknown",
    operation: "principal.policy.verify",
  };

  try {
    await Promise.all([
      service.report(error, context),
      service.report(error, context),
    ]);
    expect(await service.incidents.list()).toHaveLength(1);
  } finally {
    service.dispose();
    await close();
  }
});
test("report and rethrow preserves the terminal verification error", async () => {
  const error = new KeyingVerificationError("rollback", "stale head");
  const reported: unknown[] = [];

  await expect(
    reportAndRethrowKeyingVerificationError(
      error,
      async (caught) => {
        reported.push(caught);
      },
      {
        objectId: "group-1",
        objectKind: "principal",
        operation: "principal.policy.verify",
      },
    ),
  ).rejects.toBe(error);
  expect(reported).toEqual([error]);
});

test("context boundaries preserve verification error identity", () => {
  const error = new KeyingVerificationError("rollback", "stale head");

  expect(() =>
    throwKeyingVerificationErrorWithContext(error, "projection failed"),
  ).toThrow(error);
  expect(Reflect.get(error, "keyingVerificationContexts")).toEqual([
    "projection failed",
  ]);
  expect(
    Object.getOwnPropertyDescriptor(error, "keyingVerificationContexts")
      ?.enumerable,
  ).toBe(false);
});

test("context boundaries preserve name-matched verification errors", () => {
  const error = new Error("foreign verification failure");
  error.name = "KeyingVerificationError";
  Reflect.set(error, "code", "rollback");

  expect(() =>
    throwKeyingVerificationErrorWithContext(error, "foreign projection"),
  ).toThrow(error);
  expect(Reflect.get(error, "keyingVerificationContexts")).toEqual([
    "foreign projection",
  ]);
});

test("an incident callback cannot replace the verification failure", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-callback",
  );
  const service = createSecurityIncidentService({
    database: new Database({ execSql, status: "ready" }),
    logError: () => undefined,
    onIncident: () => {
      throw new Error("host callback failed");
    },
    trustDomain: null,
  });
  const error = new KeyingVerificationError("equivocation", "conflict");

  try {
    await expect(
      reportAndRethrowKeyingVerificationError(error, service.report, {
        objectId: "user-1",
        objectKind: "user",
        operation: "user.identity.resolve",
      }),
    ).rejects.toBe(error);
    expect(await service.incidents.list()).toHaveLength(1);
  } finally {
    service.dispose();
    await close();
  }
});
