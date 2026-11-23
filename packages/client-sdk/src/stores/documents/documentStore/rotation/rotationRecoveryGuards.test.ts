import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportAllUpdates,
  getTextValue,
  getUpdateVersionVectors,
  importSnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../../../test/helpers/data/documentFixtures";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import type { DocumentsPersistence } from "../../../../workflows/documents";
import { buildMaterializedDocumentSyncPlan } from "../../../../workflows/documents/syncPlan/syncPlanMaterial";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState, type DocumentStoreState } from "../state";
import { assertDocumentStoreCanRotateContentKey } from "./index";

test("rotation aborts a paged recovery when the runtime generation changes", async () => {
  const source = await createTestExecSql("rotation-recovery-generation-source");
  const replacement = await createTestExecSql(
    "rotation-recovery-generation-replacement",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(source.execSql);
    await sqlDocumentsPersistence.ensureSchema(replacement.execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-generation-local";
    const behindDocument = await createDocument("rotation-generation-behind");
    importSnapshot(behindDocument, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behindDocument,
      documentId: fixture.writerProjection.documentId,
      execSql: source.execSql,
      localId,
    });

    const [firstPageUpdate, secondPageUpdate] = fixture.response.updates;
    if (!firstPageUpdate || !secondPageUpdate) {
      throw new Error("Expected one retained update on each recovery page");
    }
    let state: DocumentStoreState | undefined;
    let rawRequests = 0;
    const runtime = createRotationRecoveryRuntime({
      execSql: source.execSql,
      fixture,
      responseForRequest: (request, response) => {
        rawRequests += 1;
        if (request.pullCursor !== undefined) {
          throw new Error("Stale recovery requested another history page");
        }
        if (!state) throw new Error("Expected initialized document store");
        state.runtime = createRotationRecoveryRuntime({
          execSql: replacement.execSql,
          fixture,
        });
        return {
          ...response,
          pullPage: {
            hasMore: true,
            nextCursor: "generation-page-2",
            throughUpdateId: null,
          },
          updates: [firstPageUpdate],
        };
      },
    });
    state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "Document changed during rotation recovery",
    );

    expect(rawRequests).toBe(1);
    const durableSource = await sqlDocumentsPersistence.loadDocument(
      source.execSql,
      localId,
    );
    expect(durableSource?.text).toBe("survives key");
    expect(
      await sqlDocumentsPersistence.loadDocument(replacement.execSql, localId),
    ).toBeNull();
    expect(state.doc && getTextValue(state.doc)).toBe("survives key");
  } finally {
    replacement.close();
    source.close();
  }
});

test("rotation refuses an adapter that cannot prune recovery history atomically", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-adapter-capability",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-adapter-capability-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const syncCalls = { count: 0 };
    const nonAtomicPersistence = {
      ...sqlDocumentsPersistence,
      supportsAtomicRecoveryHistoryPruning: false,
    } satisfies DocumentsPersistence;
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({ execSql, fixture, syncCalls }),
      nonAtomicPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "requires an adapter with atomic local-history pruning",
    );

    expect(syncCalls.count).toBe(0);
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, localId))?.text,
    ).toBe("survives key rotation");
  } finally {
    close();
  }
});

async function soloEdit(name: string) {
  const document = await createDocument(name);
  document.getText("text").update(name);
  document.commit();
  const data = exportAllUpdates(document);
  document.free();
  return { data, ...getUpdateVersionVectors(data) };
}

// A writer's false span used to fail every rotation of the document, and with
// it every unlink: the raw history now leaves the update out, as a sync pass
// does, records it once, and proves the rest.
test("rotation leaves a void out of the raw history it re-encrypts", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-void-history",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-void-history-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    // Signed by the document's writer, but declaring another peer's span:
    // an ordinary pull voids it at the metadata stage and continues.
    const carried = await soloEdit("rotation-void-carried");
    const declared = await soloEdit("rotation-void-declared");
    const liar = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      localVersionVector: null,
      pendingUpdates: [
        createPendingUpdateRecord({
          id: "550e8400-e29b-41d4-a716-446655440443",
          partialEndVersionVector: declared.partialEndVersionVector,
          partialStartVersionVector: declared.partialStartVersionVector,
          updateData: bytesToBase64(carried.data),
        }),
      ],
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.writerProjection,
    });
    const { updates: liarUpdates } = await createSyncResponse(liar.plan);
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture,
        responseForRequest: (_request, response) => ({
          ...response,
          updates: [...response.updates, ...liarUpdates],
        }),
      }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    await assertDocumentStoreCanRotateContentKey(state);
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, localId))?.text,
    ).toBe("survives key rotation");
    expect(
      await execSql(
        "SELECT update_id, stage FROM document_void_updates WHERE local_id = ?",
        [localId],
      ),
    ).toEqual([
      {
        stage: "loro_metadata",
        update_id: "550e8400-e29b-41d4-a716-446655440443",
      },
    ]);
  } finally {
    close();
  }
});
