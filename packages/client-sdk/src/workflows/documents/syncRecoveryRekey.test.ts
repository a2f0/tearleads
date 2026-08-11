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
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import {
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  MAX_PENDING_UPDATE_REKEYS,
  rekeyDocumentPendingUpdate,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { syncRemoteDocument } from "./sync";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";
import {
  rekeyLimitSubmitFailure,
  rekeyUnsettledRecoveryPendingUpdates,
} from "./syncRecoveryRekey";

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
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
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

test("an exhausted pending update surfaces terminally and survives the pass", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  await ensureDocumentTables(execSql);
  const scope = { appKind: "documents", localId: "exhausted-document" };
  await enqueueDocumentPendingUpdate(
    execSql,
    scope,
    await createLoroPendingUpdateFields("exhausted update"),
  );
  let [pendingUpdate] = await listDocumentPendingUpdates(execSql, scope);
  for (let attempt = 0; attempt < MAX_PENDING_UPDATE_REKEYS; attempt += 1) {
    await rekeyDocumentPendingUpdate(execSql, pendingUpdate?.id ?? "");
    [pendingUpdate] = await listDocumentPendingUpdates(execSql, scope);
  }
  if (!pendingUpdate) {
    throw new Error("Expected the capped pending update");
  }

  const terminalFailures: string[] = [];
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
    onTerminalSubmitFailure: (failure) => {
      terminalFailures.push(failure.message);
    },
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
  });

  // The pass completes, but it is not clean: the exhausted row was not
  // re-keyed again, the terminal failure fired, and the result carries the
  // count so callers keep the recorded failure instead of clearing it.
  expect(synced?.exhaustedPendingUpdateCount).toBe(1);
  expect(synced?.rekeyedPendingUpdateIds).toEqual([]);
  expect(terminalFailures).toEqual([
    `Update conflict recovery gave up after ${MAX_PENDING_UPDATE_REKEYS} re-key attempts (1 update)`,
  ]);
  const [unchanged] = await listDocumentPendingUpdates(execSql, scope);
  expect(unchanged).toMatchObject({
    id: pendingUpdate.id,
    rekeyCount: MAX_PENDING_UPDATE_REKEYS,
  });
});

test("recovery reports exhausted rows instead of re-keying them again", async () => {
  const fields = {
    partialEndVersionVector: "end",
    partialStartVersionVector: "start",
    updateData: "data",
  };
  const rekeyedInputIds: string[] = [];

  const result = await rekeyUnsettledRecoveryPendingUpdates({
    execSql,
    recoveryPendingUpdatesById: new Map([
      [
        "at-cap",
        { ...fields, id: "at-cap", rekeyCount: MAX_PENDING_UPDATE_REKEYS },
      ],
      [
        "below-cap",
        {
          ...fields,
          id: "below-cap",
          rekeyCount: MAX_PENDING_UPDATE_REKEYS - 1,
        },
      ],
      ["settled", { ...fields, id: "settled" }],
    ]),
    rekeyPendingUpdate: async (_execSql, id) => {
      rekeyedInputIds.push(id);
      return `next-${id}`;
    },
    settledPendingUpdateIds: ["settled"],
  });

  expect(result.exhaustedPendingUpdateIds).toEqual(["at-cap"]);
  expect(result.rekeyedPendingUpdateIds).toEqual(["next-below-cap"]);
  expect(rekeyedInputIds).toEqual(["below-cap"]);
});

test("the re-key limit failure names the bound for the write queue", () => {
  const failure = rekeyLimitSubmitFailure(2);
  expect(failure.ok).toBe(false);
  expect(failure.status).toBeNull();
  expect(failure.message).toBe(
    `Update conflict recovery gave up after ${MAX_PENDING_UPDATE_REKEYS} re-key attempts (2 updates)`,
  );
});

// Edge-case row 13 refinement: update-id recovery empties the in-flight
// batch while the durable rows still exist. A projection refusal on the
// recovery retry must keep the WRITE-BEARING classification — recording
// through the submit handler (403s included) — never the read-only
// revalidation handler.
test("a projection refusal after recovery stays write-bearing", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  await ensureDocumentTables(execSql);
  const scope = { appKind: "documents", localId: "recovering-document" };
  await enqueueDocumentPendingUpdate(
    execSql,
    scope,
    await createLoroPendingUpdateFields("recovering update"),
  );
  const [pendingUpdate] = await listDocumentPendingUpdates(execSql, scope);
  if (!pendingUpdate) {
    throw new Error("Expected an enqueued pending update");
  }
  let projectionRequests = 0;
  const readOnlyFailures: number[] = [];
  const submitFailures: number[] = [];

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => {
        throw new Error("Expected the Result variant to be used");
      },
      getDocumentWriterProjectionResult: async () => {
        projectionRequests += 1;
        if (projectionRequests === 1) {
          return { data: writerProjection, ok: true as const };
        }
        return {
          message: "Container keying conflicts with the document",
          ok: false as const,
          report: () => undefined,
          status: 409,
        };
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle recovery");
      },
      syncDocumentResult: async (documentId) => ({
        code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
        message: `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`,
        ok: false as const,
        report: () => undefined,
        status: 409,
      }),
    },
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onReadOnlyProjectionFailure: (failure) => {
      readOnlyFailures.push(failure.status ?? -1);
    },
    onTerminalSubmitFailure: (failure) => {
      submitFailures.push(failure.status ?? -1);
    },
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(synced).toBeNull();
  expect(projectionRequests).toBe(2);
  expect(readOnlyFailures).toEqual([]);
  expect(submitFailures).toEqual([409]);
});

// The recovery retry submits an EMPTY request while the durable rows still
// exist. A terminal failure there is what blocks the queued edits, so it
// must record through the submit handler despite carrying no writes.
test("a terminal failure after recovery still records durably", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  await ensureDocumentTables(execSql);
  const scope = { appKind: "documents", localId: "denied-after-recovery" };
  await enqueueDocumentPendingUpdate(
    execSql,
    scope,
    await createLoroPendingUpdateFields("denied update"),
  );
  const [pendingUpdate] = await listDocumentPendingUpdates(execSql, scope);
  if (!pendingUpdate) {
    throw new Error("Expected an enqueued pending update");
  }
  const submitFailures: number[] = [];
  let submissions = 0;

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle recovery");
      },
      syncDocumentResult: async (documentId) => {
        submissions += 1;
        if (submissions === 1) {
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
            message: `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`,
            ok: false as const,
            report: () => undefined,
            status: 409,
          };
        }
        return {
          message: `POST /documents/${documentId}/sync: 403 Forbidden`,
          ok: false as const,
          report: () => undefined,
          status: 403,
        };
      },
    },
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onTerminalSubmitFailure: (failure) => {
      submitFailures.push(failure.status ?? -1);
    },
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  expect(synced).toBeNull();
  expect(submissions).toBe(2);
  expect(submitFailures).toEqual([403]);
});
