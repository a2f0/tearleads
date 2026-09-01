import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { appendSecurityIncident } from "../data/persistence/securityIncidentPersistence";
import { Database } from "./database";
import { createSecurityIncidentService } from "./securityIncidents";

test("durable incidents retain at most 1,000 rows per trust domain", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-retention-limit",
  );
  const service = createSecurityIncidentService({
    database: new Database({ execSql, status: "ready" }),
    logError: () => undefined,
    trustDomain: "https://api.example.test",
  });

  try {
    for (let index = 0; index <= 1_000; index += 1) {
      await service.report(
        new KeyingVerificationError("rollback", `stale head ${index}`),
        {
          objectId: `principal-${index}`,
          objectKind: "principal",
          operation: "principal.policy.verify",
        },
      );
    }

    expect(await service.incidents.list()).toHaveLength(1_000);
    expect(
      await execSql('SELECT COUNT(*) AS "count" FROM "security_incidents"'),
    ).toEqual([{ count: 1_000 }]);
    await expect(
      appendSecurityIncident(execSql, {
        code: "rollback",
        detectedAt: "2020-01-01T00:00:00.000Z",
        evidenceHashes: {},
        lastDetectedAt: "2020-01-01T00:00:00.000Z",
        objectId: "principal-ancient-buffered",
        objectKind: "principal",
        occurrenceCount: 1,
        operation: "principal.policy.verify",
        trustDomain: "https://api.example.test",
      }),
    ).resolves.toBeNull();
    expect(
      await execSql('SELECT COUNT(*) AS "count" FROM "security_incidents"'),
    ).toEqual([{ count: 1_000 }]);
  } finally {
    service.dispose();
    await close();
  }
});

test("incident lists stay scoped to their configured trust domain", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-trust-domain-list",
  );
  const createService = (trustDomain: string) =>
    createSecurityIncidentService({
      database: new Database({ execSql, status: "ready" }),
      logError: () => undefined,
      trustDomain,
    });
  const first = createService("https://first-api.example.test");
  const second = createService("https://second-api.example.test");

  try {
    await first.report(
      new KeyingVerificationError("rollback", "first stale head"),
      {
        objectId: "principal-first",
        objectKind: "principal",
        operation: "principal.policy.verify",
      },
    );
    await second.report(
      new KeyingVerificationError("rollback", "second stale head"),
      {
        objectId: "principal-second",
        objectKind: "principal",
        operation: "principal.policy.verify",
      },
    );

    expect(await first.incidents.list()).toEqual([
      expect.objectContaining({
        objectId: "principal-first",
        trustDomain: "https://first-api.example.test",
      }),
    ]);
    expect(await second.incidents.list()).toEqual([
      expect.objectContaining({
        objectId: "principal-second",
        trustDomain: "https://second-api.example.test",
      }),
    ]);
  } finally {
    first.dispose();
    second.dispose();
    await close();
  }
});

test("coalescing retains the earliest equivalent detection timestamp", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-first-detection",
  );
  const baseIncident = {
    code: "rollback" as const,
    evidenceHashes: {},
    objectId: "principal-first-detection",
    objectKind: "principal" as const,
    occurrenceCount: 1,
    operation: "principal.policy.verify",
    trustDomain: "https://api.example.test",
  };

  try {
    await appendSecurityIncident(execSql, {
      ...baseIncident,
      detectedAt: "2026-01-01T00:00:00.000Z",
      lastDetectedAt: "2026-01-01T00:00:00.000Z",
    });
    await expect(
      appendSecurityIncident(execSql, {
        ...baseIncident,
        detectedAt: "2025-01-01T00:00:00.000Z",
        lastDetectedAt: "2025-01-01T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      detectedAt: "2025-01-01T00:00:00.000Z",
      lastDetectedAt: "2026-01-01T00:00:00.000Z",
      occurrenceCount: 2,
    });
  } finally {
    await close();
  }
});
