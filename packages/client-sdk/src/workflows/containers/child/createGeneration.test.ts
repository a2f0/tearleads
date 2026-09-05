import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createMutationResponseFromRequest,
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
      apiClient: createMockApiClient({
        createContainer: async () => {
          submitted = true;
          throw new Error("expired create must not submit");
        },
        getContainerWriterProjection: async () => parent.projection,
        getCurrentPrincipalPolicy: async () => null,
      }),
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

test("container create hides state when its generation expires after acknowledgement", async () => {
  const parent = await createParentProjection();
  const database = await createTestExecSql(
    "container-create-acknowledgement-generation",
  );
  let acknowledgementCommitted = false;
  let current = true;
  let submitted = false;
  const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
    const rows = await database.execSql(...args);
    if (submitted && args[0].trim().toUpperCase() === "COMMIT") {
      acknowledgementCommitted = true;
      current = false;
    }
    return rows;
  }) as ExecSql;

  try {
    const created = await createRemoteContainer({
      apiClient: createMockApiClient({
        createContainer: async (request) => {
          submitted = true;
          return createMutationResponseFromRequest(request);
        },
        getContainerWriterProjection: async () => parent.projection,
        getCurrentPrincipalPolicy: async () => null,
      }),
      author: parent.author,
      containerId: "expired-after-acknowledgement",
      execSql: guardedExecSql,
      parentContainerId: parent.projection.containerId,
      parentSecretKey: parent.secretKey,
      reportSecurityIncident: async () => undefined,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createParentProjectionUserKeyResolver(parent),
      stillCurrent: () => current,
    });

    expect(acknowledgementCommitted).toBe(true);
    expect(created).toBeNull();
    await expect(
      loadAccessManifestCheckpoint(
        database.execSql,
        "container",
        parent.projection.organizationId,
        "expired-after-acknowledgement",
      ),
    ).resolves.not.toBeNull();
  } finally {
    database.close();
  }
});
