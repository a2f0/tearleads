import { afterEach, beforeEach, expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/data/documentFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import type { IncomingDocumentSyncUpdateValidator } from "../../../data/documents/shared/sync/documentSyncTypes";
import { DocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import {
  emptyDocumentSyncImportVerdicts,
  voidedDocumentSyncUpdate,
} from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";
import { recordDocumentSyncVerdicts } from "./processedCursor";
import { syncRemoteDocumentResultFromResponse } from "./syncResponseResult";

const SCOPE = { appKind: "documents", localId: "key-independence" } as const;
const VOIDED_ID = "550e8400-e29b-41d4-a716-446655440e01";
const NEXT_THROUGH = "550e8400-e29b-41d4-a716-446655440e02";
const FRONTIER = encodeVersionVectorCounters({ "7": 4 });

type Fixture = Awaited<ReturnType<typeof createMaterializedSyncFixture>>;

let close: () => void = () => undefined;
let execSql: ExecSql;

beforeEach(async () => {
  const database = await createTestExecSql(`keys-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureDocumentTables(execSql);
});

afterEach(() => close());

/** Every served update is void, as a false declared span would make it. */
const voidEverything: IncomingDocumentSyncUpdateValidator = ({ response }) => ({
  ...emptyDocumentSyncImportVerdicts(),
  voided: response.updates.flatMap((served) => {
    const voided = voidedDocumentSyncUpdate(
      new DocumentSyncUpdateIsolationError({
        cause: new Error("declared span is false"),
        responseUpdate: served,
        stage: "loro_metadata",
        updateId: served.id,
      }),
    );
    return voided ? [voided] : [];
  }),
});

function planInput(fixture: Fixture) {
  return {
    author: fixture.author,
    localVersionVector: FRONTIER,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
    writerProjection: fixture.writerProjection,
  };
}

/**
 * Runs `run` with a keying database of its own. Two fixtures sign conflicting
 * manifests for one document, so each verifies its projection apart; the
 * verdicts share the scope's database.
 */
async function withKeyingDatabase<T>(
  run: (keyingExecSql: ExecSql) => Promise<T>,
): Promise<T> {
  const keying = await createTestExecSql(`keying-${crypto.randomUUID()}`);
  try {
    return await run(keying.execSql);
  } finally {
    keying.close();
  }
}

/** One whole pull page judged and saved the way a sync pass does. */
async function syncPage(
  input: {
    readonly fixture: Fixture;
    readonly sentCursor?: string | undefined;
    readonly served: Awaited<ReturnType<typeof createSyncResponse>>["updates"];
    readonly throughUpdateId: string;
  },
  keyingExecSql: ExecSql,
) {
  const { fixture } = input;
  const materializedPlan = await buildMaterializedDocumentSyncPlan({
    ...planInput(fixture),
    execSql: keyingExecSql,
    pendingUpdates: [],
    processedThroughUpdateId: input.sentCursor,
  });
  const response = await createSyncResponse(materializedPlan.plan, {
    pullPage: {
      hasMore: false,
      nextCursor: null,
      throughUpdateId: input.throughUpdateId,
    },
    updates: input.served,
  });
  const synced = await syncRemoteDocumentResultFromResponse({
    execSql: keyingExecSql,
    materializedPlan,
    recoveryPendingUpdatesById: new Map(),
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({
      author: fixture.author,
      signingPublicKey: fixture.signingPublicKey,
    }),
    response,
    targetSecretKey: fixture.secretKey,
    validateIncomingUpdates: voidEverything,
    writerProjection: fixture.writerProjection,
  });
  return recordDocumentSyncVerdicts(execSql, { scope: SCOPE, synced });
}

async function progress() {
  return {
    cursor: await execSql(
      "SELECT through_update_id FROM document_sync_progress WHERE local_id = ?",
      [SCOPE.localId],
    ),
    voids: await execSql(
      "SELECT update_id FROM document_void_updates WHERE local_id = ?",
      [SCOPE.localId],
    ),
  };
}

// The scope's content key for an epoch is not an input of any verdict: every
// recorded verdict was reached under the key its update's signed envelope
// commits to, which is the verdict any reader reaches. A pass holding another
// key for that epoch (here a fixture with its own random key, the same
// document and epoch) therefore leaves the void and moves the cursor on.
test("a cursor stays sendable after the scope's key for an epoch changes", async () => {
  const committed = await createMaterializedSyncFixture();
  const { documentId } = committed.writerProjection;
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, updated_at)
     VALUES (?, ?, ?, ?, '2026-11-23T00:00:00.000Z')`,
    [SCOPE.appKind, SCOPE.localId, documentId, FRONTIER],
  );
  await withKeyingDatabase(async (keyingExecSql) => {
    const written = await buildMaterializedDocumentSyncPlan({
      ...planInput(committed),
      execSql: keyingExecSql,
      pendingUpdates: [createPendingUpdateRecord({ id: VOIDED_ID })],
    });
    const { updates } = await createSyncResponse(written.plan);
    await syncPage(
      { fixture: committed, served: updates, throughUpdateId: VOIDED_ID },
      keyingExecSql,
    );
  });
  expect(await progress()).toEqual({
    cursor: [{ through_update_id: VOIDED_ID }],
    voids: [{ update_id: VOIDED_ID }],
  });

  const rekeyed = await createMaterializedSyncFixture();
  expect(rekeyed.writerProjection.documentId).toBe(documentId);
  expect(rekeyed.writerProjection.contentKeyBundle.contentKeyEpoch).toBe(
    committed.writerProjection.contentKeyBundle.contentKeyEpoch,
  );
  expect(rekeyed.contentKey).not.toEqual(committed.contentKey);

  await withKeyingDatabase((keyingExecSql) =>
    syncPage(
      {
        fixture: rekeyed,
        sentCursor: VOIDED_ID,
        served: [],
        throughUpdateId: NEXT_THROUGH,
      },
      keyingExecSql,
    ),
  );
  expect(await progress()).toEqual({
    cursor: [{ through_update_id: NEXT_THROUGH }],
    voids: [{ update_id: VOIDED_ID }],
  });
});
