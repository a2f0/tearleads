import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  tamperFirstProjectionEventSignature,
} from "../../../../../test/helpers/containerFixtures";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/containerMutationServiceFixture";
import { KeyingCheckpointRepository } from "../../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";

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
    createContainerMutationServiceFixture({
      reportSecurityIncident: async () => {},
      api: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async (containerId) =>
          containerId === parent.projection.containerId
            ? tamperedProjection
            : parent.projection,
        moveContainer: async () => {
          moveCalled = true;
          throw new Error("Unexpected move call");
        },
      },
      execSql: database.execSql,
      encapsulationSecretKey: parent.secretKey,
    }).moveRemoteContainer({
      author,
      containerId: parent.projection.containerId,
      destinationParentContainerId: "destination-parent",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    }),
  ).rejects.toMatchObject({ code: "signature_mismatch" });
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
    createContainerMutationServiceFixture({
      reportSecurityIncident: async () => {},
      api: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async (containerId) =>
          containerId === parent.projection.containerId
            ? parent.projection
            : tamperedProjection,
        moveContainer: async () => {
          moveCalled = true;
          throw new Error("Unexpected move call");
        },
      },
      execSql: database.execSql,
      encapsulationSecretKey: parent.secretKey,
    }).moveRemoteContainer({
      author,
      containerId: parent.projection.containerId,
      destinationParentContainerId: "tampered-destination-parent",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    }),
  ).rejects.toMatchObject({ code: "signature_mismatch" });
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
    const moved = await createContainerMutationServiceFixture({
      reportSecurityIncident: async () => {},
      api: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => parent.projection,
        moveContainer: async () => {
          moveCalled = true;
          throw new Error("Unexpected move call");
        },
      },
      execSql: guardedExecSql,
      encapsulationSecretKey: parent.secretKey,
    }).moveRemoteContainer({
      author,
      containerId: parent.projection.containerId,
      destinationParentContainerId: "destination-parent",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      stillCurrent: () => !transactionStarted,
    });

    expect(moved).toBeNull();
    expect(transactionStarted).toBe(true);
    expect(moveCalled).toBe(false);
    await expect(
      new KeyingCheckpointRepository(
        database.execSql,
      ).loadAccessManifestCheckpoint(
        "container",
        parent.projection.organizationId,
        parent.projection.containerId,
      ),
    ).resolves.toBeNull();
  } finally {
    database.close();
  }
});
