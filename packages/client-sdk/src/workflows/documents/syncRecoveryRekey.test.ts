import { afterEach, beforeEach, expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportAllUpdates,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  createSyncResponse,
} from "../../../test/helpers/documentFixtures";
import {
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { buildMaterializedDocumentSyncPlan, syncRemoteDocument } from "./sync";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-recovery-rekey",
  ));
});

afterEach(() => closeExecSql());

async function createLoroPendingUpdateFields(text: string) {
  const doc = await createDocument(`rekey-fixture:${text}`);
  doc.getText("text").update(text);
  doc.commit();
  const update = exportAllUpdates(doc);
  return {
    updateData: bytesToBase64(update),
    ...getUpdateVersionVectors(update),
  };
}

test("syncRemoteDocument re-keys pending conflicts recovery cannot settle", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  await ensureDocumentTables(execSql);
  const scope = { appKind: "documents", localId: "wedged-document" };
  await enqueueDocumentPendingUpdate(
    execSql,
    scope,
    await createLoroPendingUpdateFields("wedged update"),
  );
  const [pendingUpdate] = await listDocumentPendingUpdates(execSql, scope);
  if (!pendingUpdate) {
    throw new Error("Expected an enqueued pending update");
  }
  const submittedOutgoingCounts: number[] = [];
  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle recovery");
      },
      syncDocumentResult: async (documentId, request) => {
        submittedOutgoingCounts.push(request.outgoingUpdates.length);
        if (request.outgoingUpdates.length > 0) {
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
            message: `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`,
            ok: false,
            report: () => undefined,
            status: 409,
          };
        }

        // Production shape for a lost-ack retry: the recovery request's
        // version vector already covers the locally-applied pending update,
        // so the server's frontier filter omits it from the response.
        const readOnlyMaterialized = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection,
        });
        return {
          data: await createSyncResponse({
            ...readOnlyMaterialized.plan,
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
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    writerPublicKeysByFingerprint: new Map([
      [author.signerKeyFingerprint, signingPublicKey],
    ]),
  });

  expect(submittedOutgoingCounts).toEqual([1, 0]);
  expect(synced?.settledPendingUpdateIds).toEqual([]);
  const rekeyed = await listDocumentPendingUpdates(execSql, scope);
  expect(rekeyed).toHaveLength(1);
  expect(rekeyed[0]?.id).not.toBe(pendingUpdate.id);
  // Re-keying reports as progress so sync lanes re-arm and submit the new id.
  expect(synced?.rekeyedPendingUpdateIds).toEqual([rekeyed[0]?.id ?? ""]);
  expect(rekeyed[0]).toMatchObject({
    updateData: pendingUpdate.updateData,
    partialStartVersionVector: pendingUpdate.partialStartVersionVector,
    partialEndVersionVector: pendingUpdate.partialEndVersionVector,
  });
});
