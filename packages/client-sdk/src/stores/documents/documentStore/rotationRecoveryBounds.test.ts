import { expect, test } from "bun:test";
import { createDocument, getTextValue, importSnapshot } from "@symcrypt/loro";
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

test("rotation persists bounded pull progress but waits for full history", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-partial-pull",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-partial-pull-local";
    const behindDocument = await createDocument("partial-rotation-behind");
    importSnapshot(behindDocument, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behindDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });

    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: (request, response) => {
        if (request.pullCursor === undefined) {
          return {
            ...response,
            pullPage: { hasMore: true, nextCursor: "rotation-page-2" },
          };
        }
        if (request.pullCursor === "rotation-page-2") {
          return {
            ...response,
            acceptedOutgoingUpdateIds: [],
            pullPage: { hasMore: false, nextCursor: null },
            updates: [],
          };
        }
        throw new Error("Unexpected rotation pull cursor");
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
    let requestedSyncCount = 0;
    state.syncLane = {
      requestSync: () => {
        requestedSyncCount += 1;
      },
    } as NonNullable<typeof state.syncLane>;

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "persisted a partial pull",
    );
    expect(state.pullContinuation).toEqual({
      commitLsn: "0/16B6C50",
      commitLsnMode: "tracked",
      cursor: "rotation-page-2",
    });
    expect(requestedSyncCount).toBe(1);
    expect(state.doc && getTextValue(state.doc)).toBe("survives key rotation");

    const reloaded = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(reloaded, () => undefined)).toBe(
      true,
    );
    expect(reloaded.doc && getTextValue(reloaded.doc)).toBe(
      "survives key rotation",
    );
    expect(reloaded.pullContinuation).toEqual({
      commitLsn: "0/16B6C50",
      commitLsnMode: "tracked",
      cursor: "rotation-page-2",
    });

    await expect(
      assertDocumentStoreCanRotateContentKey(reloaded),
    ).resolves.toBeInstanceOf(Uint8Array);
    expect(reloaded.pullContinuation).toBeNull();

    const afterDrainRestart = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(
      await ensureDocumentStoreReady(afterDrainRestart, () => undefined),
    ).toBe(true);
    expect(afterDrainRestart.pullContinuation).toBeNull();
    expect(afterDrainRestart.doc && getTextValue(afterDrainRestart.doc)).toBe(
      "survives key rotation",
    );
  } finally {
    close();
  }
});

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

test("rotation aborts when another pane supersedes its durable pull settlement", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-superseded-settlement",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-superseded-settlement-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const durableContinuation = {
      commitLsn: "0/20",
      commitLsnMode: "tracked" as const,
      cursor: "other-pane-page-2",
    };
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: async (_request, response) => {
        const durableRecord = await sqlDocumentsPersistence.loadDocument(
          execSql,
          localId,
        );
        if (!durableRecord) throw new Error("Expected durable document");
        await sqlDocumentsPersistence.saveDocument(execSql, {
          ...durableRecord,
          lastCommitLsn: durableContinuation.commitLsn,
          pullContinuation: durableContinuation,
        });
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
    let requestedSyncCount = 0;
    state.syncLane = {
      requestSync: () => {
        requestedSyncCount += 1;
      },
    } as NonNullable<typeof state.syncLane>;

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "persisted a partial pull",
    );
    expect(state.pullContinuation).toEqual(durableContinuation);
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
