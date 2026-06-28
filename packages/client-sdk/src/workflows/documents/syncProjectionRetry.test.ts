import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createResponse,
  createSyncResponse,
} from "../../../test/helpers/documentFixtures";
import { buildMaterializedDocumentCreatePlan } from "./create";
import { buildMaterializedDocumentSyncPlan, syncRemoteDocument } from "./sync";

test("syncRemoteDocument refetches writer projection after a stale container KEK unwrap", async () => {
  const {
    author,
    projection,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const staleKeyPair = generateKemSeedAndKeyPair();
  const staleProjection = await createContainerWriterProjectionFixture({
    containerId: projection.containerId,
    encapsulationPublicKey: staleKeyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  let useFreshProjectionKey = false;
  const resolveProjectionUserKeyWithStaleUser = async (userId: string) => {
    const resolved = await resolveProjectionUserKey(userId);
    if (!resolved || userId !== author.signerUserId) {
      return resolved;
    }
    if (!useFreshProjectionKey) {
      return {
        ...resolved,
        encapsulationPublicKey: staleKeyPair.publicKey,
      };
    }

    return resolved;
  };
  const staleCreate = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: staleProjection,
    documentId: writerProjection.documentId,
    eventId: "event-stale-sync-projection",
    resolveProjectionUserKey: resolveProjectionUserKeyWithStaleUser,
    targetSecretKey: staleKeyPair.secretKey,
  });
  const staleResponse = createResponse(staleCreate.plan);
  const staleWriterProjection: DocumentWriterProjectionResponse = {
    contentKeyBundle: staleResponse.contentKeyBundle,
    documentId: staleResponse.id,
    documentKekTargets: staleResponse.documentKekTargets,
    documentManifest: staleResponse.accessManifest,
    authorizingContainerPaths: [staleProjection],
  };
  const pendingUpdates = [createPendingUpdateRecord()];
  const submittedRequests: DocumentSyncRequest[] = [];
  let clearCount = 0;
  let projectionRequestCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: {
      clearWriterProjectionCaches: () => {
        clearCount += 1;
        useFreshProjectionKey = true;
      },
      getDocumentWriterProjection: async (documentId) => {
        if (documentId !== writerProjection.documentId) {
          return null;
        }

        projectionRequestCount += 1;
        return projectionRequestCount === 1
          ? staleWriterProjection
          : writerProjection;
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle sync");
      },
      syncDocumentResult: async (documentId, request) => {
        submittedRequests.push(request);
        const materialized = await buildMaterializedDocumentSyncPlan({
          author,
          localVersionVector: null,
          pendingUpdates,
          resolveProjectionUserKey: resolveProjectionUserKeyWithStaleUser,
          targetSecretKey: secretKey,
          writerProjection,
        });
        return {
          data: await createSyncResponse({
            ...materialized.plan,
            documentId,
            request,
          }),
          ok: true,
        };
      },
    },
    author,
    documentId: writerProjection.documentId,
    localVersionVector: null,
    pendingUpdates,
    resolveProjectionUserKey: resolveProjectionUserKeyWithStaleUser,
    targetSecretKey: secretKey,
    writerPublicKeysByFingerprint: new Map([
      [author.signerKeyFingerprint, signingPublicKey],
    ]),
  });

  expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
  expect(clearCount).toBe(1);
  expect(projectionRequestCount).toBe(2);
  expect(submittedRequests).toHaveLength(1);
  expect(
    submittedRequests[0]?.authorizingContainerPathRefs?.[0]?.[0]?.manifestHash,
  ).toBe(projection.path[0]?.manifestHash);
});
