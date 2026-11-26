import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  emptyVersionVector,
  encodeVersionVector,
  exportUpdatesSince,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { enqueuePendingUpdate, listPendingUpdates } from "../persistence";
import { createDocumentStoreState } from "../state";
import { captureDocumentStoreSyncGeneration } from "../sync/syncGeneration";
import { settleOrdinaryDocumentUpdatesBeforeRotation } from "./rotationSettlement";

// The queued update starts past the verified base, so the history between
// them has no proven provenance. A pending base behind the gap would let the
// outgoing-coverage step queue the gap as one more ordinary update, so the
// settlement must refuse before that step runs.
test("rotation refuses to relabel an uncovered local history gap as ordinary", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-settlement-uncovered-gap",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-settlement-uncovered-gap-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    let syncCalls = 0;
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: (_request, response) => {
        syncCalls += 1;
        return response;
      },
    });
    const state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    if (!state.doc || !state.record) {
      throw new Error("Expected initialized document state");
    }
    const gapEnd = encodeVersionVector(state.doc);
    state.doc.getText("text").update("local edit past the gap");
    state.doc.commit();
    const queuedTail = exportUpdatesSince(state.doc, gapEnd);
    expect(await enqueuePendingUpdate(state, queuedTail)).toBe(true);

    state.pendingBaseVersion = emptyVersionVector();
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...state.record,
      pendingBaseVersion: state.pendingBaseVersion,
    });
    state.record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    const provenPendingUpdates = await listPendingUpdates(state);

    const generation = captureDocumentStoreSyncGeneration(state, state.doc);
    if (!generation) throw new Error("Missing live generation");
    await expect(
      settleOrdinaryDocumentUpdatesBeforeRotation(
        state,
        emptyVersionVector(),
        provenPendingUpdates,
        generation,
      ),
    ).rejects.toThrow("cannot settle uncovered local history");
    expect(syncCalls).toBe(0);
    expect(await listPendingUpdates(state)).toHaveLength(1);
    expect(
      (await sqlDocumentsPersistence.loadHistoryRestoreState(execSql, localId))
        ?.tailUpdates,
    ).toEqual([{ origin: "local", updateData: bytesToBase64(queuedTail) }]);
  } finally {
    close();
  }
});
