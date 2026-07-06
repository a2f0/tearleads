import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
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
import { retrySyncPlan } from "./syncFailures";

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
  const evictedDocumentIds: string[] = [];
  let projectionRequestCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: {
      evictDocumentWriterProjection: (documentId) => {
        evictedDocumentIds.push(documentId);
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
  expect(evictedDocumentIds).toEqual([writerProjection.documentId]);
  expect(projectionRequestCount).toBe(2);
  expect(submittedRequests).toHaveLength(1);
  expect(
    submittedRequests[0]?.authorizingContainerPathRefs?.[0]?.[0]?.manifestHash,
  ).toBe(projection.path[0]?.manifestHash);
});

test("retrySyncPlan refetches a fresh projection after a rollback verification error", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  // Distinct reference standing in for a stale, pre-share cached projection
  // whose manifest epoch is now older than a checkpoint we already recorded.
  const staleProjection: DocumentWriterProjectionResponse = {
    ...writerProjection,
  };
  const pendingUpdates = [createPendingUpdateRecord()];
  const evictedDocumentIds: string[] = [];
  let buildCount = 0;

  const planned = await retrySyncPlan({
    apiClient: {
      evictDocumentWriterProjection: (documentId) => {
        evictedDocumentIds.push(documentId);
      },
      getDocumentWriterProjection: async (documentId) =>
        documentId === writerProjection.documentId ? writerProjection : null,
      syncDocument: async () => {
        throw new Error("syncDocument is unused by retrySyncPlan");
      },
    },
    buildWithProjection: async (projection) => {
      buildCount += 1;
      if (projection === staleProjection) {
        throw new KeyingVerificationError(
          "rollback",
          "access manifest is older than the local checkpoint",
        );
      }

      return buildMaterializedDocumentSyncPlan({
        author,
        localVersionVector: null,
        pendingUpdates,
        resolveProjectionUserKey,
        targetSecretKey: secretKey,
        writerProjection: projection,
      });
    },
    documentId: writerProjection.documentId,
    writerProjection: staleProjection,
  });

  // The rollback drops the stale projection, refetches the current one, and
  // rebuilds with it — converging instead of surfacing a hard failure.
  expect(evictedDocumentIds).toEqual([writerProjection.documentId]);
  expect(buildCount).toBe(2);
  expect(planned?.[1]).toBe(writerProjection);
});
