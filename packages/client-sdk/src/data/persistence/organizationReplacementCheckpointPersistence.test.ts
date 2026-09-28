import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createReplacementAuthorizationFixture } from "../../../test/helpers/organizationReplacementAuthorization";
import {
  accessManifestCheckpoints,
  clientSqlTables,
  principalPolicyCheckpoints,
  principalPolicyOrganizations,
} from "../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../sqlite/sqlTableSchema";
import { persistOrganizationReplacementCheckpoints } from "./organizationReplacementCheckpointPersistence";

for (const conflict of ["root", "policy", "owner"] as const) {
  test(`replacement ${conflict} conflict rolls back every genesis pin and owner`, async () => {
    const { authorization } = await createReplacementAuthorizationFixture();
    const { execSql, close } = await createTestExecSql(
      "replacement-pin-conflict",
    );
    try {
      await ensureSqlTables(execSql, clientSqlTables);
      const { db } = getClientSQLitePersistenceRuntime(execSql);
      const { organizationId } = authorization;
      if (conflict === "root")
        await db.insert(accessManifestCheckpoints).values({
          organizationId,
          objectKind: "container",
          objectId: authorization.rootContainerId,
          epoch: 1,
          manifestHash: "e".repeat(64),
          updatedAt: "2026-09-28",
        });
      if (conflict === "policy")
        await db.insert(principalPolicyCheckpoints).values({
          principalType: "group",
          principalId: authorization.memberGroupId,
          version: 1,
          stateHash: "e".repeat(64),
          updatedAt: "2026-09-28",
        });
      if (conflict === "owner")
        await db.insert(principalPolicyOrganizations).values({
          principalType: "group",
          principalId: authorization.memberGroupId,
          organizationId: crypto.randomUUID(),
        });
      const snapshot = () =>
        Promise.all([
          db.select().from(accessManifestCheckpoints),
          db.select().from(principalPolicyCheckpoints),
          db.select().from(principalPolicyOrganizations),
        ]);
      const before = await snapshot();
      await expect(
        persistOrganizationReplacementCheckpoints({ authorization, execSql }),
      ).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    } finally {
      close();
    }
  });
}

test("replacement replay preserves later checkpoints and restores authenticated ownership", async () => {
  const { authorization } = await createReplacementAuthorizationFixture();
  const { execSql, close } = await createTestExecSql("replacement-pin-later");
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db.insert(accessManifestCheckpoints).values({
      organizationId: authorization.organizationId,
      objectKind: "container",
      objectId: authorization.rootContainerId,
      epoch: 3,
      manifestHash: "e".repeat(64),
      updatedAt: "2026-09-28",
    });
    await db.insert(principalPolicyCheckpoints).values({
      principalType: "group",
      principalId: authorization.adminGroupId,
      version: 4,
      stateHash: "f".repeat(64),
      updatedAt: "2026-09-28",
    });
    expect(
      await persistOrganizationReplacementCheckpoints({
        authorization,
        execSql,
      }),
    ).toBe(true);
    expect(await db.select().from(accessManifestCheckpoints)).toEqual([
      expect.objectContaining({ epoch: 3, manifestHash: "e".repeat(64) }),
    ]);
    expect(await db.select().from(principalPolicyCheckpoints)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: authorization.adminGroupId,
          version: 4,
          stateHash: "f".repeat(64),
        }),
        expect.objectContaining({
          principalId: authorization.memberGroupId,
          version: 1,
          stateHash: authorization.memberGroupStateHash,
        }),
        expect.objectContaining({
          principalId: authorization.organizationId,
          version: 1,
          stateHash: authorization.organizationStateHash,
        }),
      ]),
    );
    expect(await db.select().from(principalPolicyOrganizations)).toHaveLength(
      3,
    );
  } finally {
    close();
  }
});

test("an identity change refuses the entire replacement checkpoint transaction", async () => {
  const { authorization } = await createReplacementAuthorizationFixture();
  const { execSql, close } = await createTestExecSql(
    "replacement-pin-identity",
  );
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    expect(
      await persistOrganizationReplacementCheckpoints({
        authorization,
        execSql,
        stillCurrent: () => false,
      }),
    ).toBe(false);
    expect(await db.select().from(accessManifestCheckpoints)).toEqual([]);
    expect(await db.select().from(principalPolicyCheckpoints)).toEqual([]);
    expect(await db.select().from(principalPolicyOrganizations)).toEqual([]);
  } finally {
    close();
  }
});
