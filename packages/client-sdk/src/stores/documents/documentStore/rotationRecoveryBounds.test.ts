import { expect, test } from "bun:test";
import { createDocument, getTextValue, importSnapshot } from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
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
import { assertDocumentStoreCanRotateContentKey } from "./rotation";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";

test("rotation validates every bounded page before one durable install", async () => {
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

    const [firstPageUpdate, secondPageUpdate] = fixture.response.updates;
    if (!firstPageUpdate || !secondPageUpdate) {
      throw new Error("Expected one retained update on each recovery page");
    }
    let failBeforeSecondPage = true;
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: async (request, response) => {
        if (request.pullCursor === undefined) {
          return {
            ...response,
            pullPage: { hasMore: true, nextCursor: "rotation-page-2" },
            updates: [firstPageUpdate],
          };
        }
        if (request.pullCursor === "rotation-page-2") {
          if (failBeforeSecondPage) {
            throw new Error("Simulated failure before raw-history page 2");
          }
          return {
            ...response,
            acceptedOutgoingUpdateIds: [],
            pullPage: { hasMore: false, nextCursor: null },
            updates: [secondPageUpdate],
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
    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "Simulated failure before raw-history page 2",
    );
    expect(state.pullContinuation).toBeNull();
    expect(state.doc && getTextValue(state.doc)).toBe("survives key");

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
    expect(reloaded.pullContinuation).toBeNull();
    expect(reloaded.doc && getTextValue(reloaded.doc)).toBe("survives key");

    failBeforeSecondPage = false;
    await expect(
      assertDocumentStoreCanRotateContentKey(reloaded),
    ).resolves.toBeInstanceOf(Uint8Array);
    expect(reloaded.pullContinuation).toBeNull();
    expect(reloaded.doc && getTextValue(reloaded.doc)).toBe(
      "survives key rotation",
    );
  } finally {
    close();
  }
});

test("rotation invalidates a continuation and drains a bounded local queue", async () => {
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
    const continuation = {
      commitLsn: "0/20",
      commitLsnMode: "tracked" as const,
      cursor: "stale-page-2",
    };
    const persistedRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );
    if (!persistedRecord) throw new Error("Expected persisted document");
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...persistedRecord,
      lastCommitLsn: continuation.commitLsn,
      pullContinuation: continuation,
    });

    const committedUpdates: DocumentSyncResponse["updates"] = [];
    const outgoingCounts: number[] = [];
    const historyModes: Array<"raw" | undefined> = [];
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture,
        requireRawHistory: false,
        responseForRequest: (request, response) => {
          outgoingCounts.push(request.outgoingUpdates.length);
          historyModes.push(request.historyMode);
          const outgoingIds = new Set(
            request.outgoingUpdates.map((update) => update.id),
          );
          committedUpdates.push(
            ...response.updates.filter((update) => outgoingIds.has(update.id)),
          );
          return {
            ...response,
            updates: [...fixture.response.updates, ...committedUpdates],
          };
        },
      }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    expect(state.pullContinuation).toEqual(continuation);
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

    const baseline = await assertDocumentStoreCanRotateContentKey(state);

    expect(await listPendingUpdates(state)).toHaveLength(0);
    expect(state.pullContinuation).toBeNull();
    expect(outgoingCounts).toEqual([64, 1, 0]);
    expect(historyModes).toEqual([undefined, undefined, "raw"]);
    expect(requestedSyncCount).toBe(0);
    const recovered = await createDocument("bounded-tail-reader");
    importSnapshot(recovered, baseline);
    expect(getTextValue(recovered)).toBe("pending local edit 64");
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
      "superseded during its atomic install",
    );
    expect(state.pullContinuation).toEqual(durableContinuation);
    expect(requestedSyncCount).toBe(1);
  } finally {
    close();
  }
});
