import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../../test/helpers/data/containerFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../../test/helpers/data/trustedUserIdentity";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/workflows/containerMutationServiceFixture";
import { createRemoteDocumentForTest as createRemoteDocument } from "../../../../../test/helpers/workflows/remoteDocumentServiceFixture";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "./index";

async function createReadOnlyFixture(
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
) {
  const readerKeys = generateKemSeedAndKeyPair();
  const reader = await createAuthor({
    organizationId: "organization-1",
    userId: "reader",
  });
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "read",
      publicKey: readerKeys.publicKey,
      recipientKeyEpochId: `user:reader:encapsulation:${await toFingerprint(readerKeys.publicKey)}`,
      userId: "reader",
    },
  });
  const ownerResolver = createParentProjectionUserKeyResolver(parent);
  const readerResolver = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: readerKeys.publicKey,
    signingKeyFingerprint: reader.author.signerKeyFingerprint,
    signingPublicKey: reader.signingPublicKey,
    userId: "reader",
  });
  const resolve = (userId: string) =>
    userId === parent.userId ? ownerResolver(userId) : readerResolver(userId);
  const child = async (containerId: string) =>
    childContainerWriterProjectionFromCreatePlan({
      parentProjection: parent.projection,
      materializedPlan: await buildMaterializedContainerCreatePlan({
        author: parent.author,
        execSql,
        containerId,
        metadataDocumentId: `${containerId}-metadata`,
        parentProjection: parent.projection,
        parentSecretKey: parent.secretKey,
        resolveProjectionUserKey: resolve,
      }),
    });
  return {
    reader,
    readerKeys,
    resolve,
    source: await child("readable-source"),
    destination: await child("readable-destination"),
  };
}

test.each(["create", "share", "rekey", "revoke", "move"] as const)(
  "a readable projection cannot authorize %s or an echoed acknowledgement",
  async (operation) => {
    const database = await createTestExecSql(`read-only-${operation}`);
    const fixture = await createReadOnlyFixture(database.execSql);
    let submissions = 0;
    let reads = 0;
    const denySubmission = async () => {
      submissions++;
      throw new Error("An unauthorized plan reached the server");
    };
    const apiClient = createMockApiClient({
      getContainerWriterProjection: async (id) => {
        reads++;
        return id === fixture.destination.containerId
          ? fixture.destination
          : fixture.source;
      },
      createContainerResult: denySubmission,
      shareContainer: denySubmission,
      rekeyContainer: denySubmission,
      revokeContainer: denySubmission,
      moveContainer: denySubmission,
    });
    const containers = createContainerMutationServiceFixture({
      api: apiClient,
      encapsulationSecretKey: fixture.readerKeys.secretKey,
      execSql: database.execSql,
      reportSecurityIncident: async () => {},
      resolveTrustedUserIdentity: fixture.resolve,
    });
    const input = {
      author: fixture.reader.author,
      containerId: fixture.source.containerId,
      resolveProjectionUserKey: fixture.resolve,
    };
    try {
      const run = () => {
        switch (operation) {
          case "create":
            return containers.createRemoteContainer({
              ...input,
              containerId: "unauthorized-child",
              parentContainerId: fixture.source.containerId,
            });
          case "share":
            return containers.shareRemoteContainer({
              ...input,
              accessLevel: "admin",
              recipientUserId: "reader",
            });
          case "rekey":
            return containers.rekeyRemoteContainer(input);
          case "revoke":
            return containers.revokeRemoteContainer({
              ...input,
              revokedSubject: { subjectType: "user", subjectId: "reader" },
            });
          case "move":
            return containers.moveRemoteContainer({
              ...input,
              destinationParentContainerId: fixture.destination.containerId,
            });
        }
      };
      await expect(run()).rejects.toMatchObject({ code: "unauthorized" });
      expect(reads).toBeGreaterThan(0);
      expect(submissions).toBe(0);
    } finally {
      database.close();
    }
  },
);

test("document creation records read-only authority as a terminal 403", async () => {
  const database = await createTestExecSql("read-only-document-create");
  const fixture = await createReadOnlyFixture(database.execSql);
  let submissions = 0;
  const failures: { status: number | null; message: string }[] = [];
  try {
    const result = await createRemoteDocument({
      apiClient: createMockApiClient({
        getContainerWriterProjectionResult: async () => ({
          ok: true,
          data: fixture.source,
        }),
        createDocumentResult: async () => {
          submissions++;
          throw new Error("An unauthorized document create reached the server");
        },
      }),
      author: fixture.reader.author,
      containerId: fixture.source.containerId,
      execSql: database.execSql,
      onTerminalSubmitFailure: (failure) => {
        failures.push(failure);
      },
      resolveProjectionUserKey: fixture.resolve,
      targetSecretKey: fixture.readerKeys.secretKey,
    });
    expect(result).toBeNull();
    expect(submissions).toBe(0);
    expect(failures).toEqual([
      { status: 403, message: expect.stringContaining("write access") },
    ]);
  } finally {
    database.close();
  }
});
