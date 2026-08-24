import { expect, test } from "bun:test";
import { createDocument, getTextValue, importSnapshot } from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { DocumentsPersistence } from "../../../workflows/documents";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";
import { finalizeDocumentSync } from "./syncFinalize";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";

test("a superseded finalize keeps its signal and requests another pass", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-sync-finalize-superseded",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "document-sync-finalize-superseded-local";
    const behindDocument = await createDocument(
      "document-sync-finalize-superseded-behind",
    );
    importSnapshot(behindDocument, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behindDocument,
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
    let historyLoadCount = 0;
    let atomicStateLoadCount = 0;
    const guardedPersistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async loadDocumentWithHistoryRestoreState(
        historyExecSql,
        historyLocalId,
      ) {
        atomicStateLoadCount += 1;
        return sqlDocumentsPersistence.loadDocumentWithHistoryRestoreState(
          historyExecSql,
          historyLocalId,
        );
      },
      async loadHistoryRestoreState(historyExecSql, historyLocalId) {
        historyLoadCount += 1;
        if (historyLoadCount > 1) {
          throw new Error("History reloaded after the superseded SQL claim");
        }
        return sqlDocumentsPersistence.loadHistoryRestoreState(
          historyExecSql,
          historyLocalId,
        );
      },
    };
    const state = createDocumentStoreState(
      localId,
      runtime,
      guardedPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    const currentDoc = state.doc;
    const currentRecord = state.record;
    if (!currentDoc || !currentRecord) {
      throw new Error("Expected initialized document state");
    }
    const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
    if (!generation) throw new Error("Expected current sync generation");
    state.remoteUpdatePending = true;
    state.remoteUpdateSignalSeq = 1;
    let requestedSyncCount = 0;
    state.syncLane = {
      requestSync: () => {
        requestedSyncCount += 1;
      },
    } as NonNullable<typeof state.syncLane>;

    const attempt = await requestRemoteDocumentSync({
      currentDoc,
      currentRecord,
      encapsulationKeyPair: fixture,
      generation,
      pendingUpdates: [],
      state,
      unavailableWriterLogMessage: "unexpected unavailable writer",
    });
    if (!attempt) throw new Error("Expected a completed sync response");
    expect(attempt.synced.decryptedUpdates.length).toBeGreaterThan(0);
    await finalizeDocumentSync(
      state,
      currentDoc,
      currentRecord,
      attempt,
      1,
      generation,
      [],
      false,
    );

    expect(state.pullContinuation).toEqual(durableContinuation);
    if (!state.doc) throw new Error("Expected reloaded document state");
    expect(getTextValue(state.doc)).toBe("survives key");
    expect(state.remoteUpdatePending).toBe(true);
    expect(requestedSyncCount).toBe(1);
    expect(historyLoadCount).toBe(1);
    expect(atomicStateLoadCount).toBe(1);

    const restartedState = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(
      await ensureDocumentStoreReady(restartedState, () => undefined),
    ).toBe(true);
    if (!restartedState.doc)
      throw new Error("Expected restarted document state");
    expect(getTextValue(restartedState.doc)).toBe("survives key");
  } finally {
    close();
  }
});
