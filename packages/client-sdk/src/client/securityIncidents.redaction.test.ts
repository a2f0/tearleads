import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
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

test("evidence truncation keeps code-unit-first keys on every locale", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-evidence-truncation-order",
  );
  const service = createSecurityIncidentService({
    database: new Database({ execSql, status: "ready" }),
    logError: () => undefined,
    trustDomain: null,
  });

  try {
    // 32 lowercase keys plus one uppercase key: code-unit order puts "Z"
    // (0x5a) before "a" (0x61), locale collation would sort it last and the
    // truncation to 32 keys would drop it, changing the incident id by locale.
    const evidenceHashes: Record<string, string> = { Z: "z".repeat(64) };
    for (let index = 1; index <= 32; index += 1) {
      evidenceHashes[`a${String(index).padStart(2, "0")}`] = "h".repeat(64);
    }
    await service.report(
      new KeyingVerificationError("rollback", "stale head"),
      {
        evidenceHashes,
        objectId: "object",
        objectKind: "document",
        operation: "document.sync",
        organizationId: "org",
      },
    );

    const [incident] = (await service.incidents.list()) ?? [];
    const keys = Object.keys(incident?.evidenceHashes ?? {});
    expect(keys).toHaveLength(32);
    expect(keys).toContain("Z");
    expect(keys).not.toContain("a32");
  } finally {
    service.dispose();
    await close();
  }
});

test("a __proto__ evidence key survives reporting and reading back", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incidents-proto-evidence-key",
  );
  const service = createSecurityIncidentService({
    database: new Database({ execSql, status: "ready" }),
    logError: () => undefined,
    trustDomain: null,
  });

  try {
    const evidenceHashes = Object.fromEntries([
      ["__proto__", "p".repeat(64)],
      ["manifestHash", "m".repeat(64)],
    ]) as Record<string, string>;
    expect(Object.hasOwn(evidenceHashes, "__proto__")).toBe(true);
    await service.report(
      new KeyingVerificationError("rollback", "stale head"),
      {
        evidenceHashes,
        objectId: "object",
        objectKind: "document",
        operation: "document.sync",
        organizationId: "org",
      },
    );

    const [incident] = (await service.incidents.list()) ?? [];
    const listed = incident?.evidenceHashes ?? {};
    const { manifestHash } = listed;
    expect(Object.hasOwn(listed, "__proto__")).toBe(true);
    expect(manifestHash).toBe("m".repeat(64));
  } finally {
    service.dispose();
    await close();
  }
});
