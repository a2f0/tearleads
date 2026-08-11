import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { reportAndRethrowKeyingVerificationError } from "../data/keyingProjectionVerification/error";
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
  const error = new KeyingVerificationError(
    "signature_mismatch",
    "secret server-controlled diagnostic",
  );

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
    await close();
  }
});
