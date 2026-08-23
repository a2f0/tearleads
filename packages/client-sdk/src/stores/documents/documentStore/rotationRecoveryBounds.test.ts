import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import {
  advancePendingBaseVersion,
  enqueuePendingUpdate,
  listPendingUpdates,
  pendingDeltaSinceBase,
  persistDocument,
} from "./persistence";
import {
  assertDocumentStoreCanRotateContentKey,
  shouldRequestRotationRecoverySync,
} from "./rotation";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";

test("a bounded rotation preflight re-arms its unsent queue tail", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-bounded-tail",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-bounded-tail-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });

    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({ execSql, fixture }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    if (!state.doc) {
      throw new Error("Expected full-history document");
    }
    for (let index = 0; index < 65; index += 1) {
      state.doc.getText("text").update(`pending local edit ${index}`);
      await enqueuePendingUpdate(
        state,
        pendingDeltaSinceBase(state, state.doc),
      );
      advancePendingBaseVersion(state, state.doc);
    }
    await persistDocument(state, state.doc);
    expect(await listPendingUpdates(state)).toHaveLength(65);

    let requestedSyncCount = 0;
    state.syncLane = {
      requestSync: () => {
        requestedSyncCount += 1;
      },
    } as NonNullable<typeof state.syncLane>;

    await assertDocumentStoreCanRotateContentKey(state);

    expect(await listPendingUpdates(state)).toHaveLength(1);
    expect(requestedSyncCount).toBe(1);
  } finally {
    close();
  }
});

test("rotation recovery only re-arms for deferred durable progress", () => {
  expect(
    shouldRequestRotationRecoverySync({
      hasDeferredPendingUpdates: true,
      hasIncompletePull: false,
    }),
  ).toBe(true);
  expect(
    shouldRequestRotationRecoverySync({
      hasDeferredPendingUpdates: false,
      hasIncompletePull: false,
    }),
  ).toBe(false);
  expect(
    shouldRequestRotationRecoverySync({
      hasDeferredPendingUpdates: false,
      hasIncompletePull: true,
    }),
  ).toBe(true);
});
