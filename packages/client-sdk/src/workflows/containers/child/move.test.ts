import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  tamperFirstProjectionEventSignature,
} from "../../../../test/helpers/containerFixtures";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { moveRemoteContainer } from "./move";

test("moveRemoteContainer rejects bad source projection signatures before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const tamperedProjection = tamperFirstProjectionEventSignature(
    parent.projection,
  );
  let moveCalled = false;
  const database = await createTestExecSql("move-bad-source-signature");

  await expect(
    moveRemoteContainer({
      apiClient: {
        getContainerWriterProjection: async (containerId) =>
          containerId === parent.projection.containerId
            ? tamperedProjection
            : parent.projection,
        moveContainer: async () => {
          moveCalled = true;
          throw new Error("Unexpected move call");
        },
      },
      author,
      containerId: parent.projection.containerId,
      destinationParentContainerId: "destination-parent",
      execSql: database.execSql,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow(
    "Container writer projection path[0] signature verification failed",
  );
  expect(moveCalled).toBe(false);
  database.close();
});

test("moveRemoteContainer rejects bad destination projection signatures before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const tamperedProjection = tamperFirstProjectionEventSignature(
    parent.projection,
  );
  let moveCalled = false;
  const database = await createTestExecSql("move-bad-destination-signature");

  await expect(
    moveRemoteContainer({
      apiClient: {
        getContainerWriterProjection: async (containerId) =>
          containerId === parent.projection.containerId
            ? parent.projection
            : tamperedProjection,
        moveContainer: async () => {
          moveCalled = true;
          throw new Error("Unexpected move call");
        },
      },
      author,
      containerId: parent.projection.containerId,
      destinationParentContainerId: "tampered-destination-parent",
      execSql: database.execSql,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow(
    "Container writer projection path[0] signature verification failed",
  );
  expect(moveCalled).toBe(false);
  database.close();
});

test("move planning rolls back checkpoints after its generation expires", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const database = await createTestExecSql("move-expired-generation");
  let moveCalled = false;
  let transactionStarted = false;
  const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
    const rows = await database.execSql(...args);
    if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
      transactionStarted = true;
    }
    return rows;
  }) as ExecSql;

  try {
    const moved = await moveRemoteContainer({
      apiClient: {
        getContainerWriterProjection: async () => parent.projection,
        moveContainer: async () => {
          moveCalled = true;
          throw new Error("Unexpected move call");
        },
      },
      author,
      containerId: parent.projection.containerId,
      destinationParentContainerId: "destination-parent",
      execSql: guardedExecSql,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      stillCurrent: () => !transactionStarted,
      targetSecretKey: parent.secretKey,
    });

    expect(moved).toBeNull();
    expect(transactionStarted).toBe(true);
    expect(moveCalled).toBe(false);
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
