import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { createRemoteContainer } from "./create";

test("container create planning rolls back checkpoints after generation expiry", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const database = await createTestExecSql(
    "container-create-projection-generation",
  );
  let submitted = false;
  let transactionStarted = false;
  const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
    const rows = await database.execSql(...args);
    if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
      transactionStarted = true;
    }
    return rows;
  }) as ExecSql;

  try {
    const created = await createRemoteContainer({
      apiClient: {
        createContainer: async () => {
          submitted = true;
          throw new Error("expired create must not submit");
        },
        getContainerWriterProjection: async () => parent.projection,
        getCurrentPrincipalPolicy: async () => null,
      },
      author,
      containerId: "expired-container-create",
      execSql: guardedExecSql,
      parentContainerId: parent.projection.containerId,
      parentSecretKey: parent.secretKey,
      reportSecurityIncident: async () => undefined,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createParentProjectionUserKeyResolver(parent),
      stillCurrent: () => !transactionStarted,
    });

    expect(created).toBeNull();
    expect(transactionStarted).toBe(true);
    expect(submitted).toBe(false);
    await expect(
      loadAccessManifestCheckpoint(
        database.execSql,
        "container",
        parent.projection.organizationId,
        parent.projection.containerId,
      ),
    ).resolves.toBeNull();
  } finally {
    database.close();
  }
});
