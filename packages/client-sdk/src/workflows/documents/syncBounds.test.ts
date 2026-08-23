import { afterEach, beforeEach, expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  exportAllUpdates,
  exportFullHistorySnapshot,
  getUpdateVersionVectors,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { DOCUMENT_SYNC_ERROR_CODES } from "@symcrypt/validators/response";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@symcrypt/validators/util";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { createStaleBundleSyncFixture } from "../../../test/helpers/staleBundleSyncFixture";
import type { DocumentSyncSubmitFailure } from "../../data/documents/shared/types";
import { ensureDocumentTables } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { syncRemoteDocument } from "./sync";
import { buildDocumentSyncPlan } from "./syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-bounds",
  ));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

test("conflict recovery re-keys only updates submitted by a bounded request", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const pendingUpdates = Array.from({ length: 65 }, (_, index) =>
    createPendingUpdateRecord({
      id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`,
    }),
  );
  const submittedIds: string[] = [];
  const rekeyedIds: string[] = [];
  let submitCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle recovery");
      },
      syncDocumentResult: async (documentId, request) => {
        submitCount += 1;
        if (submitCount === 1) {
          submittedIds.push(...request.outgoingUpdates.map(({ id }) => id));
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
            message: `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`,
            ok: false,
            report: () => undefined,
            status: 409,
          };
        }

        const readPlan = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection,
        });
        return {
          data: await createSyncResponse(
            { ...readPlan.plan, documentId, request },
            { acceptedOutgoingUpdateIds: [], updates: [] },
          ),
          ok: true,
        };
      },
    },
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates,
    rekeyPendingUpdate: async (_execSql, id) => {
      rekeyedIds.push(id);
      return crypto.randomUUID();
    },
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
  });

  expect(submittedIds).toHaveLength(64);
  expect(rekeyedIds).toEqual(submittedIds);
  expect(rekeyedIds).not.toContain(pendingUpdates[64]?.id);
  expect(synced?.rekeyedPendingUpdateIds).toHaveLength(64);
  expect(synced?.hasDeferredPendingUpdates).toBe(true);
});

test("a heal classifies a queued checkpoint beyond the outgoing batch prefix", async () => {
  const fixture = await createStaleBundleSyncFixture();
  const doc = await createDocument("tail-checkpoint-source");
  doc.getText("text").update("history covered by the tail checkpoint");
  doc.commit();
  const update = exportAllUpdates(doc);
  const vectors = getUpdateVersionVectors(update);
  const ordinaryUpdates = Array.from({ length: 64 }, (_, index) =>
    createPendingUpdateRecord({
      id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`,
      updateData: bytesToBase64(update),
      ...vectors,
    }),
  );
  const tailCheckpoint = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440999",
    sourceVersionVector: vectors.partialEndVersionVector,
    updateData: bytesToBase64(exportFullHistorySnapshot(doc)),
    partialStartVersionVector: "{}",
    partialEndVersionVector: vectors.partialEndVersionVector,
  });

  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    buildRotationSnapshot: async () => exportFullHistorySnapshot(doc),
    localVersionVector: null,
    pendingUpdates: [...ordinaryUpdates, tailCheckpoint],
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.staleWriterProjection,
  });

  expect(materialized.plan.request.outgoingUpdates).toHaveLength(64);
  expect(materialized.plan.request.outgoingUpdates[0]?.checkpointKind).toBe(
    "rotate_baseline",
  );
  expect(
    materialized.plan.request.outgoingUpdates.map(({ id }) => id),
  ).not.toContain(tailCheckpoint.id);
  expect(materialized.heldBackPendingUpdateIds).toEqual([tailCheckpoint.id]);
});

test("an encrypted update that cannot fit records a terminal queue failure", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const terminalFailures: DocumentSyncSubmitFailure[] = [];
  const abandonedReasons: string[] = [];
  let submitCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async () => {
        submitCount += 1;
        throw new Error("An oversized plan must not reach the network");
      },
    },
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onSyncAbandoned: (reason) => abandonedReasons.push(reason),
    onTerminalSubmitFailure: (failure) => {
      terminalFailures.push(failure);
    },
    pendingUpdates: [
      createPendingUpdateRecord({
        // This fits the preliminary plaintext-character bound. Encryption and
        // the signed request envelope make the final JSON exceed 16 MiB.
        updateData: "A".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES),
      }),
    ],
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
    writerProjection,
  });

  expect(synced).toBeNull();
  expect(submitCount).toBe(0);
  expect(terminalFailures).toHaveLength(1);
  expect(terminalFailures[0]?.code).toBe("document_sync_request_too_large");
  expect(terminalFailures[0]?.message).toContain(
    "cannot fit within the request limit",
  );
  expect(abandonedReasons).toEqual([
    "a queued update cannot fit within the document sync request limit",
  ]);
});

test("a high-actor write above the old vector ceiling remains syncable", async () => {
  const fixture = await createMaterializedSyncFixture();
  const highActorVector = "V".repeat(64 * 1024 + 1);
  const pendingUpdate = createPendingUpdateRecord({
    partialEndVersionVector: highActorVector,
    partialStartVersionVector: highActorVector,
  });
  let submittedVectorLength = 0;

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => fixture.writerProjection,
      syncDocument: async (documentId, request) => {
        submittedVectorLength =
          request.outgoingUpdates[0]?.partialEndVersionVector.length ?? 0;
        const plan = await buildDocumentSyncPlan({
          author: fixture.author,
          contentKeyBundle: fixture.writerProjection.contentKeyBundle,
          documentId,
          documentKekTargets: fixture.writerProjection.documentKekTargets,
          documentManifest: fixture.writerProjection.documentManifest,
          localVersionVector: null,
        });
        return createSyncResponse(
          { ...plan, request },
          {
            acceptedOutgoingUpdateIds: request.outgoingUpdates.map(
              (update) => update.id,
            ),
            updates: [],
          },
        );
      },
    },
    author: fixture.author,
    documentId: fixture.writerProjection.documentId,
    execSql,
    localVersionVector: highActorVector,
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({
      author: fixture.author,
      signingPublicKey: fixture.signingPublicKey,
    }),
    targetSecretKey: fixture.secretKey,
    writerProjection: fixture.writerProjection,
  });

  expect(submittedVectorLength).toBe(highActorVector.length);
  expect(synced?.settledPendingUpdateIds).toEqual([pendingUpdate.id]);
});

test("an oversized read frontier falls back to a complete pull", async () => {
  const fixture = await createMaterializedSyncFixture();
  let submittedLocalVersionVector: string | null | undefined;

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => fixture.writerProjection,
      syncDocument: async (documentId, request) => {
        submittedLocalVersionVector = request.localVersionVector;
        const plan = await buildDocumentSyncPlan({
          author: fixture.author,
          contentKeyBundle: fixture.writerProjection.contentKeyBundle,
          documentId,
          documentKekTargets: fixture.writerProjection.documentKekTargets,
          documentManifest: fixture.writerProjection.documentManifest,
          localVersionVector: null,
        });
        return createSyncResponse(
          { ...plan, request },
          { acceptedOutgoingUpdateIds: [], updates: [] },
        );
      },
    },
    author: fixture.author,
    documentId: fixture.writerProjection.documentId,
    execSql,
    localVersionVector: "V".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES),
    pendingUpdates: [],
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({
      author: fixture.author,
      signingPublicKey: fixture.signingPublicKey,
    }),
    targetSecretKey: fixture.secretKey,
    writerProjection: fixture.writerProjection,
  });

  expect(submittedLocalVersionVector).toBeNull();
  expect(synced).not.toBeNull();
});
