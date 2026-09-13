import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../test/helpers/containerFixtures";
import {
  createMaterializedSyncFixture,
  createResponse,
  writerProjectionEvidence,
} from "../../../test/helpers/documentFixtures";
import { buildMaterializedDocumentCreatePlan } from "./create";
import { buildMaterializedDocumentLinkSetMutationPlan } from "./linkSet";
import { relinkRemoteDocument } from "./linkSetRemote";

async function createFixture(
  accessLevel: "read" | "write",
  side: "source" | "target",
) {
  const database = await createTestExecSql(
    `link-authority-${side}-${accessLevel}`,
  );
  const source = await createMaterializedSyncFixture({ userId: "linker" });
  const target = await createParentProjection({
    existingUserRecipient: {
      accessLevel,
      publicKey: source.publicKey,
      recipientKeyEpochId: `user:linker:encapsulation:${await toFingerprint(source.publicKey)}`,
      userId: "linker",
    },
  });
  const targetResolver = createParentProjectionUserKeyResolver(target);
  let writerProjection = source.writerProjection;
  let targetContainerProjection = target.projection;
  if (side === "source") {
    const created = await buildMaterializedDocumentCreatePlan({
      author: target.author,
      containerProjection: target.projection,
      targetSecretKey: target.secretKey,
      trustedLocalProjection: true,
    });
    const response = createResponse(created.plan);
    writerProjection = {
      authorizingContainerPaths: [target.projection],
      contentKeyBundle: response.contentKeyBundle,
      ...writerProjectionEvidence([target.projection], []),
      documentId: response.id,
      documentKekTargets: response.documentKekTargets,
      documentManifest: response.accessManifest,
    };
    const ownContainer = source.writerProjection.authorizingContainerPaths[0];
    if (!ownContainer) throw new Error("Expected writable destination");
    targetContainerProjection = ownContainer;
  }
  return {
    close: database.close,
    input: {
      author: source.author,
      execSql: database.execSql,
      operation: "link" as const,
      resolveProjectionUserKey: (userId: string) =>
        userId === target.userId
          ? targetResolver(userId)
          : source.resolveProjectionUserKey(userId),
      targetContainerProjection,
      targetSecretKey: source.secretKey,
      writerProjection,
    },
  };
}

async function expectRemoteRefusal(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const failures: (number | null)[] = [];
  const input = fixture.input;
  const result = await relinkRemoteDocument({
    ...input,
    apiClient: createMockApiClient({
      getContainerWriterProjection: async () => input.targetContainerProjection,
      getDocumentWriterProjection: async () => input.writerProjection,
      linkDocument: async () => {
        throw new Error("Unauthorized link was submitted");
      },
    }),
    documentId: input.writerProjection.documentId,
    targetContainerId: input.targetContainerProjection.containerId,
    onFailure: (failure) => {
      failures.push(failure.status);
    },
  });
  expect(result).toBeNull();
  expect(failures).toEqual([403]);
}

for (const side of ["source", "target"] as const) {
  test.each(["read", "write"] as const)(
    `a document link checks the ${side}'s %s grant before signing`,
    async (accessLevel) => {
      const fixture = await createFixture(accessLevel, side);
      let preparations = 0;
      try {
        const result = buildMaterializedDocumentLinkSetMutationPlan({
          ...fixture.input,
          prepareBlobRewraps: async () => {
            preparations++;
            return [];
          },
        });
        if (accessLevel === "read") {
          await expect(result).rejects.toMatchObject({ code: "unauthorized" });
          expect(preparations).toBe(0);
          await expectRemoteRefusal(fixture);
        } else {
          expect((await result).plan.state.linkedContainerIds).toContain(
            fixture.input.targetContainerProjection.containerId,
          );
          expect(preparations).toBe(1);
        }
      } finally {
        fixture.close();
      }
    },
  );
}
