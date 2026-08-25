import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { retrySyncPlan } from "./syncFailures";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

test("syncRemoteDocument refetches writer projection after a stale container KEK unwrap", async () => {
  const {
    author,
    projection,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const validSecretKey = secretKey.slice();
  crypto.getRandomValues(secretKey);
  const pendingUpdates = [createPendingUpdateRecord()];
  const submittedRequests: DocumentSyncRequest[] = [];
  const evictedDocumentIds: string[] = [];
  let projectionRequestCount = 0;
  const { close, execSql } = await createTestExecSql("sync-projection-retry");

  const synced = await syncRemoteDocument({
    apiClient: {
      evictDocumentWriterProjection: (documentId) => {
        evictedDocumentIds.push(documentId);
        secretKey.set(validSecretKey);
      },
      getDocumentWriterProjection: async (documentId) => {
        if (documentId !== writerProjection.documentId) {
          return null;
        }

        projectionRequestCount += 1;
        return writerProjection;
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle sync");
      },
      syncDocumentResult: async (documentId, request) => {
        submittedRequests.push(request);
        const materialized = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates,
          resolveProjectionUserKey,
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
    execSql,
    localVersionVector: null,
    pendingUpdates,
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });
  close();

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
  const { close, execSql } = await createTestExecSql("sync-rollback-retry");

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
        execSql,
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
  close();

  // The rollback drops the stale projection, refetches the current one, and
  // rebuilds with it — converging instead of surfacing a hard failure.
  expect(evictedDocumentIds).toEqual([writerProjection.documentId]);
  expect(buildCount).toBe(2);
  expect(planned?.[1]).toBe(writerProjection);
});

test("retrySyncPlan refetches once after a normalized invalid projection", async () => {
  const { writerProjection } = await createMaterializedSyncFixture();
  const staleProjection: DocumentWriterProjectionResponse = {
    ...writerProjection,
  };
  let buildCount = 0;
  let evictionCount = 0;

  const planned = await retrySyncPlan({
    apiClient: {
      evictDocumentWriterProjection: () => {
        evictionCount += 1;
      },
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async () => null,
    },
    buildWithProjection: async (projection) => {
      buildCount += 1;
      if (projection === staleProjection) {
        throw new KeyingVerificationError(
          "invalid_shape",
          "cached projection failed normalized verification",
        );
      }
      return {} as Awaited<
        ReturnType<typeof buildMaterializedDocumentSyncPlan>
      >;
    },
    documentId: writerProjection.documentId,
    writerProjection: staleProjection,
  });

  expect(evictionCount).toBe(1);
  expect(buildCount).toBe(2);
  expect(planned?.[1]).toBe(writerProjection);
});

test("retrySyncPlan does not retry identity failures that resemble stale unwraps", async () => {
  const { writerProjection } = await createMaterializedSyncFixture();
  const integrityError = new KeyingVerificationError(
    "object_mismatch",
    "Document authorizing container KEK path could not be unwrapped from Container writer projection KEK",
  );
  let builds = 0;
  let evictions = 0;
  let projectionRequests = 0;

  await expect(
    retrySyncPlan({
      apiClient: {
        evictDocumentWriterProjection: () => {
          evictions += 1;
        },
        getDocumentWriterProjection: async () => {
          projectionRequests += 1;
          return writerProjection;
        },
        syncDocument: async () => null,
      },
      buildWithProjection: async () => {
        builds += 1;
        throw integrityError;
      },
      documentId: writerProjection.documentId,
      writerProjection,
    }),
  ).rejects.toBe(integrityError);
  expect(builds).toBe(1);
  expect(evictions).toBe(0);
  expect(projectionRequests).toBe(0);
});
