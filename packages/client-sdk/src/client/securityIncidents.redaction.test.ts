import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import { Database } from "./database";
import { createSecurityIncidentService } from "./securityIncidents";

test("security incident identifiers are bounded before persistence", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-bounded-identifiers",
  );
  const service = createSecurityIncidentService({
    database: new Database({ execSql, status: "ready" }),
    logError: () => undefined,
    trustDomain: null,
  });

  try {
    await service.report(
      new KeyingVerificationError("rollback", "stale head"),
      {
        objectId: "o".repeat(1_000),
        objectKind: "principal",
        operation: "operation.".repeat(100),
        organizationId: "g".repeat(1_000),
      },
    );

    const [incident] = (await service.incidents.list()) ?? [];
    expect(incident?.operation).toHaveLength(128);
    expect(incident?.objectId).toHaveLength(256);
    expect(incident?.organizationId).toHaveLength(256);
  } finally {
    service.dispose();
    await close();
  }
});
