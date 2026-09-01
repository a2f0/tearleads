import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { isDocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  createPreparedUpdate,
  createSyncFixture,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { InvalidDocumentSyncPullContinuationError } from "../../data/documents/shared/syncPagination";
import { buildDocumentSyncPlan } from "./syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

test("buildDocumentSyncPlan creates an explicit raw-history pull", async () => {
  const { author, createResponse } = await createSyncFixture();
  const plan = await buildDocumentSyncPlan({
    author,
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    historyMode: "raw",
    localVersionVector: null,
  });

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  expect(plan.request.historyMode).toBe("raw");
  expect(plan.request.outgoingUpdates).toEqual([]);
  expect(plan.request.authorizingContainerPathRefs).toBeUndefined();
  expect(plan.request.contentKeyBundle).toBeUndefined();
});

test("buildDocumentSyncPlan rejects outgoing updates in raw-history mode", async () => {
  const { author, createResponse } = await createSyncFixture();

  await expect(
    buildDocumentSyncPlan({
      author,
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: createResponse.accessManifest,
      historyMode: "raw",
      localVersionVector: null,
      outgoingUpdates: [await createPreparedUpdate()],
    }),
  ).rejects.toThrow("raw-history sync must be read-only");
});

test("buildDocumentSyncPlan rejects a non-null raw-history frontier", async () => {
  const { author, createResponse } = await createSyncFixture();

  await expect(
    buildDocumentSyncPlan({
      author,
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: createResponse.accessManifest,
      historyMode: "raw",
      localVersionVector: "{}",
    }),
  ).rejects.toThrow("raw-history sync must start from a null version vector");
});

test("raw history fails a stale cursor without restarting its frozen pull", async () => {
  const { close, execSql } = await createTestExecSql(
    "raw-history-stale-cursor",
  );
  try {
    const fixture = await createMaterializedSyncFixture();
    const materialized = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      execSql,
      historyMode: "raw",
      localVersionVector: null,
      pendingUpdates: [],
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
    });
    const requestedCursors: Array<string | undefined> = [];
    let invalidationCount = 0;
    const pullContinuation = {
      commitLsn: "0/16B6C50",
      commitLsnMode: "tracked" as const,
      cursor: "stale-raw-page-2",
    };

    const recovery = syncRemoteDocument({
      apiClient: {
        getDocumentWriterProjection: async () => fixture.writerProjection,
        syncDocument: async () => {
          throw new Error("Expected syncDocumentResult to handle raw sync");
        },
        syncDocumentResult: async (documentId, request) => {
          requestedCursors.push(request.pullCursor);
          return {
            data: await createSyncResponse(
              { ...materialized.plan, documentId, request },
              {
                acceptedOutgoingUpdateIds: [],
                pullPage: {
                  hasMore: true,
                  nextCursor: request.pullCursor ?? "unexpected-restart",
                },
                updates: [],
              },
            ),
            ok: true,
          };
        },
      },
      author: fixture.author,
      documentId: fixture.writerProjection.documentId,
      execSql,
      historyMode: "raw",
      localVersionVector: null,
      onPullContinuationInvalidated: () => {
        invalidationCount += 1;
      },
      pendingUpdates: [],
      persistedState: {
        contentKeyBundle: JSON.stringify(
          fixture.writerProjection.contentKeyBundle,
        ),
        documentId: fixture.writerProjection.documentId,
        documentKekTargets: JSON.stringify(
          fixture.writerProjection.documentKekTargets,
        ),
        documentManifestBundle: JSON.stringify(
          fixture.writerProjection.documentManifest,
        ),
      },
      pullContinuation,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver(fixture),
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
    });

    await expect(recovery).rejects.toBeInstanceOf(
      InvalidDocumentSyncPullContinuationError,
    );
    expect(requestedCursors).toEqual([pullContinuation.cursor]);
    expect(invalidationCount).toBe(0);
  } finally {
    close();
  }
});

test("raw history fails a page-two state conflict without restarting", async () => {
  const { close, execSql } = await createTestExecSql(
    "raw-history-page-two-state-conflict",
  );
  try {
    const fixture = await createMaterializedSyncFixture();
    const requestedCursors: Array<string | undefined> = [];
    let invalidationCount = 0;
    const pullContinuation = {
      commitLsn: "0/16B6C50",
      commitLsnMode: "tracked" as const,
      cursor: "conflicted-raw-page-2",
    };

    const recovery = syncRemoteDocument({
      apiClient: {
        getDocumentWriterProjection: async () => fixture.writerProjection,
        syncDocument: async () => {
          throw new Error("Expected syncDocumentResult to handle raw sync");
        },
        syncDocumentResult: async (_documentId, request) => {
          requestedCursors.push(request.pullCursor);
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
            message: "Document sync state changed during frozen raw pull",
            ok: false,
            report: () => undefined,
            status: 409,
          };
        },
      },
      author: fixture.author,
      documentId: fixture.writerProjection.documentId,
      execSql,
      historyMode: "raw",
      localVersionVector: null,
      onPullContinuationInvalidated: () => {
        invalidationCount += 1;
      },
      pendingUpdates: [],
      persistedState: {
        contentKeyBundle: JSON.stringify(
          fixture.writerProjection.contentKeyBundle,
        ),
        documentId: fixture.writerProjection.documentId,
        documentKekTargets: JSON.stringify(
          fixture.writerProjection.documentKekTargets,
        ),
        documentManifestBundle: JSON.stringify(
          fixture.writerProjection.documentManifest,
        ),
      },
      pullContinuation,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver(fixture),
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
    });

    await expect(recovery).rejects.toThrow(
      "raw-history continuation became stale",
    );
    expect(requestedCursors).toEqual([pullContinuation.cursor]);
    expect(invalidationCount).toBe(0);
  } finally {
    close();
  }
});
