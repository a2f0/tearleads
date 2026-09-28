import { expect, test } from "bun:test";
import { type BlobStore, clearRemoteSyncState } from "@tearleads/client-sdk";
import {
  clientSQLiteSchema,
  defineSqlTableSchema,
  type ExecSql,
} from "@tearleads/client-sdk/sqlite";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { unexpectedSecurityIncidents } from "../../../test/helpers/unexpectedSecurityIncidents";
import { createBackupPayload, restoreBackupPayload } from "./localBackupData";

const blobStore: BlobStore = {
  deleteBytes: async () => {},
  readBytes: async () => null,
  openByteSource: async () => null,
  writeByteSource: async () => {},
  writeBytes: async () => {},
};

async function initialize(execSql: ExecSql) {
  for (const table of Object.values(clientSQLiteSchema))
    await execSql(defineSqlTableSchema(table).createSql);
}

async function pin(
  execSql: ExecSql,
  groupId: string,
  owner: string,
  version: number,
) {
  await execSql(
    "INSERT INTO principal_policy_checkpoints VALUES (?, ?, ?, ?, ?)",
    ["group", groupId, version, "a".repeat(64), "2026-09-28"],
  );
  await execSql("INSERT INTO principal_policy_organizations VALUES (?, ?, ?)", [
    "group",
    groupId,
    owner,
  ]);
}

for (const ownerTable of ["absent", "empty"] as const) {
  test(`restore retains current policy ownership and permits recovery (owner table=${ownerTable})`, async () => {
    const source = createNativeTestExecSql();
    const target = createNativeTestExecSql();
    try {
      await initialize(source.execSql);
      await initialize(target.execSql);
      await pin(target.execSql, "current-only", "org", 2);
      if (ownerTable === "absent")
        await source.execSql("DROP TABLE principal_policy_organizations");
      const payload = await createBackupPayload({
        blobStore,
        execSql: source.execSql,
        databaseId: null,
        signingFingerprint: null,
      });
      await restoreBackupPayload({
        blobStore,
        execSql: target.execSql,
        payload,
        securityIncidents: unexpectedSecurityIncidents,
      });
      expect(
        await target.execSql("SELECT * FROM principal_policy_organizations"),
      ).toEqual([
        {
          principal_type: "group",
          principal_id: "current-only",
          organization_id: "org",
        },
      ]);
      await clearRemoteSyncState(target.execSql, { organizationId: "org" });
      expect(
        await target.execSql(
          "SELECT principal_id, version FROM principal_policy_checkpoints",
        ),
      ).toEqual([{ principal_id: "current-only", version: 2 }]);
    } finally {
      source.close();
      target.close();
    }
  });
}

test("restore merges backup-only policy owners with live checkpoint owners", async () => {
  const source = createNativeTestExecSql();
  const target = createNativeTestExecSql();
  try {
    await initialize(source.execSql);
    await initialize(target.execSql);
    await pin(source.execSql, "backup-only", "backup-org", 1);
    await pin(source.execSql, "overlap", "org", 1);
    await pin(target.execSql, "overlap", "org", 3);
    await pin(target.execSql, "current-only", "org", 2);
    const payload = await createBackupPayload({
      blobStore,
      execSql: source.execSql,
      databaseId: null,
      signingFingerprint: null,
    });
    await restoreBackupPayload({
      blobStore,
      execSql: target.execSql,
      payload,
      securityIncidents: unexpectedSecurityIncidents,
    });
    expect(
      await target.execSql(
        "SELECT principal_id, organization_id FROM principal_policy_organizations ORDER BY principal_id",
      ),
    ).toEqual([
      { principal_id: "backup-only", organization_id: "backup-org" },
      { principal_id: "current-only", organization_id: "org" },
      { principal_id: "overlap", organization_id: "org" },
    ]);
    await clearRemoteSyncState(target.execSql, { organizationId: "org" });
    expect(
      await target.execSql(
        "SELECT version FROM principal_policy_checkpoints WHERE principal_id = 'overlap'",
      ),
    ).toEqual([{ version: 3 }]);
  } finally {
    source.close();
    target.close();
  }
});

test("conflicting policy ownership refuses restore before replacing the live database", async () => {
  const source = createNativeTestExecSql();
  const target = createNativeTestExecSql();
  try {
    await initialize(source.execSql);
    await initialize(target.execSql);
    await pin(source.execSql, "group", "other-org", 1);
    await pin(target.execSql, "group", "org", 2);
    const payload = await createBackupPayload({
      blobStore,
      execSql: source.execSql,
      databaseId: null,
      signingFingerprint: null,
    });
    await expect(
      restoreBackupPayload({
        blobStore,
        execSql: target.execSql,
        payload,
        securityIncidents: unexpectedSecurityIncidents,
      }),
    ).rejects.toThrow(
      "Backup conflicts with principal policy organization ownership",
    );
    expect(
      await target.execSql(
        "SELECT organization_id FROM principal_policy_organizations",
      ),
    ).toEqual([{ organization_id: "org" }]);
    expect(
      await target.execSql("SELECT version FROM principal_policy_checkpoints"),
    ).toEqual([{ version: 2 }]);
  } finally {
    source.close();
    target.close();
  }
});

for (const ownerTable of ["absent", "empty"] as const) {
  test(`an unowned backup checkpoint refuses restore (${ownerTable})`, async () => {
    const source = createNativeTestExecSql();
    const target = createNativeTestExecSql();
    try {
      await initialize(source.execSql);
      await initialize(target.execSql);
      await pin(source.execSql, "unowned", "backup-org", 1);
      await pin(target.execSql, "current", "org", 2);
      await source.execSql(
        ownerTable === "absent"
          ? "DROP TABLE principal_policy_organizations"
          : "DELETE FROM principal_policy_organizations",
      );
      const payload = await createBackupPayload({
        blobStore,
        execSql: source.execSql,
        databaseId: null,
        signingFingerprint: null,
      });
      await expect(
        restoreBackupPayload({
          blobStore,
          execSql: target.execSql,
          payload,
          securityIncidents: unexpectedSecurityIncidents,
        }),
      ).rejects.toThrow("Backup contains an unowned group policy checkpoint");
      expect(
        await target.execSql(
          "SELECT principal_id FROM principal_policy_checkpoints",
        ),
      ).toEqual([{ principal_id: "current" }]);
    } finally {
      source.close();
      target.close();
    }
  });
}
