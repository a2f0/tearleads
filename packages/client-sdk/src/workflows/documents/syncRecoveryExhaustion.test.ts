import { afterEach, beforeEach, expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  exportAllUpdates,
  getUpdateVersionVectors,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { DOCUMENT_SYNC_ERROR_CODES } from "@symcrypt/validators/response";
import {
  createMaterializedSyncFixture,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import {
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  MAX_PENDING_UPDATE_REKEYS,
  rekeyDocumentPendingUpdate,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-recovery-exhaustion",
  ));
});

afterEach(() => closeExecSql());

async function pendingUpdateFields(text: string) {
  const doc = await createDocument(`mixed-recovery:${text}`);
  doc.getText("text").update(text);
  doc.commit();
  const update = exportAllUpdates(doc);
  return {
    updateData: bytesToBase64(update),
    ...getUpdateVersionVectors(update),
  };
}

test("an exhausted row prevents mixed recovery from hot-looping", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  await ensureDocumentTables(execSql);
  const scope = { appKind: "documents", localId: "mixed-exhaustion" };
  await enqueueDocumentPendingUpdate(
    execSql,
    scope,
    await pendingUpdateFields("exhausted half"),
  );
  let pendingUpdates = await listDocumentPendingUpdates(execSql, scope);
  let exhaustedUpdate = pendingUpdates[0];
  if (!exhaustedUpdate) {
    throw new Error("Expected an enqueued pending update");
  }
  for (let attempt = 0; attempt < MAX_PENDING_UPDATE_REKEYS; attempt += 1) {
    await rekeyDocumentPendingUpdate(execSql, exhaustedUpdate.id);
    pendingUpdates = await listDocumentPendingUpdates(execSql, scope);
    exhaustedUpdate = pendingUpdates[0];
    if (!exhaustedUpdate) {
      throw new Error("Expected the re-keyed pending update");
    }
  }
  await enqueueDocumentPendingUpdate(
    execSql,
    scope,
    await pendingUpdateFields("recoverable half"),
  );
  pendingUpdates = await listDocumentPendingUpdates(execSql, scope);

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle recovery");
      },
      syncDocumentResult: async (documentId, request) => {
        if (request.outgoingUpdates.length > 0) {
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
            message: `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`,
            ok: false,
            report: () => undefined,
            status: 409,
          };
        }
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
    pendingUpdates,
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
  });

  expect(synced?.exhaustedPendingUpdateCount).toBe(1);
  expect(synced?.rekeyedPendingUpdateIds).toHaveLength(1);
  expect(synced?.hasDeferredPendingUpdates).toBe(false);
});
