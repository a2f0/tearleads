import { expect, test } from "bun:test";
import { Tearleads } from "@tearleads/client-sdk";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  preflightSecurityAnchorRestore,
  readBackupDatabase,
  restoreBackupDatabase,
} from "./localBackupDatabase";

test("real SDK incident evidence and its index survive preflight and database restore", async () => {
  const database = createNativeTestExecSql();
  const sdk = new Tearleads({
    apiBaseUrl: "https://api.example.test",
    database: { execSql: database.execSql },
    logger: { log() {}, logError() {} },
  });
  const client: unknown = Reflect.get(sdk, "apiClient");
  if (!client || typeof client !== "object")
    throw new Error("Expected API client");
  let failure = new KeyingVerificationError(
    "equivocation",
    "injected signed identity failure",
  );
  Reflect.set(client, "getUserIdentity", async () => {
    throw failure;
  });
  try {
    await expect(
      sdk.userIdentities.resolve("11111111-1111-4111-8111-111111111111"),
    ).rejects.toBe(failure);
    const before = await sdk.securityIncidents.list();
    expect(before).toHaveLength(1);
    const backup = await readBackupDatabase({ execSql: database.execSql });
    await preflightSecurityAnchorRestore({
      execSql: database.execSql,
      restoredTables: backup.tables,
    });
    await restoreBackupDatabase({
      execSql: database.execSql,
      tables: [],
      indexes: [],
    });
    expect(await sdk.securityIncidents.list()).toEqual(before);
    expect(
      await database.execSql(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'security_incidents_trust_last_detected_idx'",
      ),
    ).toHaveLength(1);
    // A fresh error observation accumulates on the restored identity. The SDK
    // deduplicates repeated reports of the exact same Error instance.
    failure = new KeyingVerificationError(
      "equivocation",
      "another observation",
    );
    await expect(
      sdk.userIdentities.resolve("11111111-1111-4111-8111-111111111111"),
    ).rejects.toBe(failure);
    expect((await sdk.securityIncidents.list())?.[0]?.occurrenceCount).toBe(2);
  } finally {
    sdk.dispose();
    database.close();
  }
});
