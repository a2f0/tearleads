import { afterEach, beforeEach, expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/data/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/workflows/documentSync";
import { createLoroPendingUpdate } from "../../../../test/helpers/workflows/documentSyncFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

const CURSOR = "550e8400-e29b-41d4-a716-446655440e01";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } =
    await createTestExecSql("cursor-recover"));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

async function heldVersion(): Promise<string> {
  const document = await createDocument("cursor-recover-held");
  document.getText("text").insert(0, "held");
  document.commit();
  const version = encodeVersionVector(document);
  document.free();
  return version;
}

test("a recovery pass that lowers its version sends no processed cursor", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    fixture;
  const pendingUpdate = await createLoroPendingUpdate("settled update");
  const requests: DocumentSyncRequest[] = [];

  await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async () => writerProjection,
      syncDocumentResult: async (documentId, request) => {
        requests.push(request);
        if (requests.length === 1) {
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
            kind: "http",
            message: `POST /documents/${documentId}/sync: 409 Conflict`,
            method: "POST",
            ok: false,
            path: "mock-request",
            report: () => undefined,
            status: 409,
            statusText: "",
          };
        }
        const current = await buildMaterializedDocumentSyncPlan({
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
            { ...current.plan, documentId, request },
            { updates: [] },
          ),
          ok: true,
        };
      },
    }),
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: await heldVersion(),
    pendingUpdates: [pendingUpdate],
    processedThroughUpdateId: CURSOR,
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver(fixture),
    targetSecretKey: secretKey,
  });

  expect(requests).toHaveLength(2);
  expect(requests[0]?.processedThroughUpdateId).toBe(CURSOR);
  // The recovery pass asks for updates below its own version again, which
  // the cursor would let the server skip.
  expect(requests[1]?.outgoingUpdates).toEqual([]);
  expect(requests[1] && "processedThroughUpdateId" in requests[1]).toBe(false);
});
