import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  emptyVersionVector,
  exportFullHistorySnapshot,
  getUpdateVersionVectors,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { enqueuePendingUpdate, listPendingUpdates } from "./persistence";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { settleOrdinaryDocumentUpdatesBeforeRotation } from "./rotationSettlement";
import { createDocumentStoreState } from "./state";

test("rotation refuses to relabel an uncovered checkpoint gap as ordinary", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-settlement-checkpoint-gap",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-settlement-checkpoint-gap-local";
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
    const checkpoint = exportFullHistorySnapshot(state.doc);
    const vectors = getUpdateVersionVectors(checkpoint);
    expect(
      await enqueuePendingUpdate(
        state,
        checkpoint,
        vectors.partialEndVersionVector,
      ),
    ).toBe(true);

    state.pendingBaseVersion = emptyVersionVector();
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...state.record,
      pendingBaseVersion: state.pendingBaseVersion,
    });
    state.record = await sqlDocumentsPersistence.loadDocument(execSql, localId);

    await expect(
      settleOrdinaryDocumentUpdatesBeforeRotation(state, emptyVersionVector()),
    ).rejects.toThrow("may be checkpoint-derived");
    expect(syncCalls).toBe(0);
    expect(await listPendingUpdates(state)).toHaveLength(1);
    expect(
      (await sqlDocumentsPersistence.loadHistoryRestoreState(execSql, localId))
        ?.tailUpdates,
    ).toEqual([{ origin: "local", updateData: bytesToBase64(checkpoint) }]);
  } finally {
    close();
  }
});
