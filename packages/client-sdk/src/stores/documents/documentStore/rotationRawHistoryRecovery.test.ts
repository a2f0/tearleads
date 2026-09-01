import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  getTextValue,
  getUpdateVersionVectors,
  importSnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../../test/helpers/documentFixtures";
import {
  buildRotatedDocumentContentKeyBundle,
  collectContainerKeksForDocumentSync,
} from "../../../data/documents/shared/projection";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { hasRecordedTerminalSyncFailures } from "../../../data/sqlite/documentPersistence";
import {
  DocumentRawHistoryUnavailableError,
  isDocumentSyncUpdateIsolationError,
} from "../../../workflows/documents";
import { buildMaterializedDocumentSyncPlan } from "../../../workflows/documents/syncPlanMaterial";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { setDocumentText } from "./mutations";
import { enqueuePendingUpdate, listPendingUpdates } from "./persistence";
import { assertDocumentStoreCanRotateContentKey } from "./rotation";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";

async function createForgedRotationBaseline(
  fixture: Awaited<ReturnType<typeof createRemoteHistoryFixture>>,
  updateId: string,
) {
  const forgedDocument = await createDocument("rotation-recovery-remote");
  forgedDocument.getText("text").update("forged value");
  forgedDocument.commit();
  forgedDocument.getText("text").update("forged value hidden!!");
  forgedDocument.commit();
  expect(encodeVersionVector(forgedDocument)).toBe(
    encodeVersionVector(fixture.remoteDocument),
  );
  const snapshot = exportFullHistorySnapshot(forgedDocument);
  const vectors = getUpdateVersionVectors(snapshot);
  const plan = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        id: updateId,
        sourceVersionVector: vectors.partialEndVersionVector,
        updateData: bytesToBase64(snapshot),
        ...vectors,
      }),
    ],
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  return {
    document: forgedDocument,
    response: await createSyncResponse(plan.plan, {
      acceptedOutgoingUpdateIds: [],
    }),
    snapshot,
    vectors,
  };
}

test("raw recovery quarantines a same-page forged rotation baseline", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-forged-baseline",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const forged = await createForgedRotationBaseline(
      fixture,
      "550e8400-e29b-41d4-a716-446655440445",
    );
    const rawResponse = {
      ...fixture.response,
      updates: [...fixture.response.updates, ...forged.response.updates],
    };
    const localId = "rotation-recovery-forged-baseline-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const requests: Array<{
      historyMode: "raw" | undefined;
      outgoingIds: string[];
    }> = [];
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: (request, response) => {
        requests.push({
          historyMode: request.historyMode,
          outgoingIds: request.outgoingUpdates.map((update) => update.id),
        });
        return request.historyMode === "raw" ? rawResponse : response;
      },
    });
    let injectCheckpointBeforeInstall = true;
    const racingPersistence = {
      ...sqlDocumentsPersistence,
      commitDocumentMutation: async (
        ...args: Parameters<
          typeof sqlDocumentsPersistence.commitDocumentMutation
        >
      ) => {
        if (injectCheckpointBeforeInstall && args[1].historyCheckpoint) {
          injectCheckpointBeforeInstall = false;
          await sqlDocumentsPersistence.enqueuePendingUpdate(
            args[0],
            {
              localId,
              partialEndVersionVector: forged.vectors.partialEndVersionVector,
              partialStartVersionVector:
                forged.vectors.partialStartVersionVector,
              sourceVersionVector: forged.vectors.partialEndVersionVector,
              updateData: bytesToBase64(forged.snapshot),
            },
            {
              expectedDocumentId: fixture.writerProjection.documentId,
              expectedRecoveryGeneration: 0,
            },
          );
        }
        return sqlDocumentsPersistence.commitDocumentMutation(...args);
      },
    };
    const state = createDocumentStoreState(
      localId,
      runtime,
      racingPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    expect(
      await enqueuePendingUpdate(
        state,
        forged.snapshot,
        forged.vectors.partialEndVersionVector,
      ),
    ).toBe(true);

    const historyBefore = await sqlDocumentsPersistence.loadHistoryRestoreState(
      execSql,
      localId,
    );
    const pendingBefore = await listPendingUpdates(state);
    const error = await assertDocumentStoreCanRotateContentKey(state).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(isDocumentSyncUpdateIsolationError(error)).toBe(true);
    if (!isDocumentSyncUpdateIsolationError(error)) return;
    expect(error.attribution).toBe("batch");
    expect(error.stage).toBe("loro_import");
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(true);
    expect(await listPendingUpdates(state)).toEqual(pendingBefore);
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState(execSql, localId),
    ).toEqual(historyBefore);
    expect(state.doc && getTextValue(state.doc)).toBe("survives key rotation");
    expect(requests).toEqual([{ historyMode: "raw", outgoingIds: [] }]);
  } finally {
    close();
  }
});

test("raw recovery does not launder preinstalled unverified history", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-preinstalled-unverified",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const forged = await createForgedRotationBaseline(
      fixture,
      "550e8400-e29b-41d4-a716-446655440447",
    );
    forged.document.getText("text").update("preinstalled forged history");
    forged.document.commit();
    const forgedSnapshot = exportFullHistorySnapshot(forged.document);
    const forgedVectors = getUpdateVersionVectors(forgedSnapshot);
    const localId = "rotation-recovery-preinstalled-unverified-local";
    await persistFullHistoryDocument({
      doc: forged.document,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });

    const requests: Array<{
      historyMode: "raw" | undefined;
      outgoing: number;
    }> = [];
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture,
        responseForRequest: (request, response) => {
          requests.push({
            historyMode: request.historyMode,
            outgoing: request.outgoingUpdates.length,
          });
          return response;
        },
      }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    expect(
      await enqueuePendingUpdate(
        state,
        forgedSnapshot,
        forgedVectors.partialEndVersionVector,
      ),
    ).toBe(true);
    const queuedCheckpoint = (await listPendingUpdates(state))[0];
    if (!queuedCheckpoint) throw new Error("Expected queued checkpoint");
    const historyBefore = await sqlDocumentsPersistence.loadHistoryRestoreState(
      execSql,
      localId,
    );

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "unverified local history",
    );

    expect(requests).toEqual([{ historyMode: "raw", outgoing: 0 }]);
    expect(
      (await listPendingUpdates(state)).map((update) => update.id),
    ).toEqual([queuedCheckpoint.id]);
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState(execSql, localId),
    ).toEqual(historyBefore);
    expect(state.doc && getTextValue(state.doc)).toBe(
      "preinstalled forged history",
    );
  } finally {
    close();
  }
});

test("local settlement waits for raw provenance verification", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-settlement-stages-baseline",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const forged = await createForgedRotationBaseline(
      fixture,
      "550e8400-e29b-41d4-a716-446655440446",
    );
    const localId = "rotation-settlement-stages-baseline-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture,
        requireRawHistory: false,
        responseForRequest: (request, response) => {
          if (request.historyMode === "raw") {
            throw new Error("Simulated raw recovery failure");
          }
          return {
            ...response,
            updates: [...response.updates, ...forged.response.updates],
          };
        },
      }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    if (!state.doc) throw new Error("Expected full-history document");
    await setDocumentText(state, () => undefined, "pending local edit");
    expect(await listPendingUpdates(state)).toHaveLength(1);
    const historyBefore = await sqlDocumentsPersistence.loadHistoryRestoreState(
      execSql,
      localId,
    );

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "Simulated raw recovery failure",
    );

    expect(await listPendingUpdates(state)).toHaveLength(1);
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState(execSql, localId),
    ).toEqual(historyBefore);
    expect(state.doc && getTextValue(state.doc)).toBe("pending local edit");
  } finally {
    close();
  }
});

test("a malformed historical bundle is poison-isolated instead of reported unavailable", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-malformed-historical-bundle",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const collectedKeks = await collectContainerKeksForDocumentSync({
      secretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.writerProjection,
    });
    const currentContentKeyBundle = await buildRotatedDocumentContentKeyBundle({
      containerKeksByEpochId: collectedKeks.keksByEpochId,
      contentKey: crypto.getRandomValues(new Uint8Array(32)),
      writerProjection: fixture.writerProjection,
    });
    const [historicalTarget, ...otherHistoricalTargets] =
      fixture.response.contentKeyBundle.targets;
    if (!historicalTarget) {
      throw new Error("Expected historical content-key target");
    }
    const malformedHistoricalBundle = {
      ...fixture.response.contentKeyBundle,
      targets: [
        {
          ...historicalTarget,
          wrappedKey: bytesToBase64(new Uint8Array([1, 2, 3])),
        },
        ...otherHistoricalTargets,
      ],
    };
    const currentFixture = {
      ...fixture,
      response: {
        ...fixture.response,
        contentKeyBundle: currentContentKeyBundle,
        contentKeyBundles: [malformedHistoricalBundle, currentContentKeyBundle],
      },
      writerProjection: {
        ...fixture.writerProjection,
        contentKeyBundle: currentContentKeyBundle,
      },
    };
    const localId = "rotation-recovery-malformed-historical-bundle-local";
    const behindReader = await createDocument("malformed-bundle-behind");
    importSnapshot(behindReader, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behindReader,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const originalRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture: currentFixture,
      }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    // Exercise persisted-state planning followed by an uncached projection
    // fetch; this lane must preserve poison-isolation failures too.
    state.writerProjection = null;

    const error = await assertDocumentStoreCanRotateContentKey(state).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(isDocumentSyncUpdateIsolationError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(DocumentRawHistoryUnavailableError);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(true);
    expect(state.doc && getTextValue(state.doc)).toBe("survives key");
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, localId),
    ).toEqual(originalRecord);
  } finally {
    close();
  }
});

test("a missing raw-history bundle is poison-isolated without durable mutation", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-unavailable-epoch",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const collectedKeks = await collectContainerKeksForDocumentSync({
      secretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.writerProjection,
    });
    const currentContentKeyBundle = await buildRotatedDocumentContentKeyBundle({
      containerKeksByEpochId: collectedKeks.keksByEpochId,
      contentKey: crypto.getRandomValues(new Uint8Array(32)),
      writerProjection: fixture.writerProjection,
    });
    const currentFixture = {
      ...fixture,
      response: {
        ...fixture.response,
        contentKeyBundle: currentContentKeyBundle,
        contentKeyBundles: [currentContentKeyBundle],
      },
      writerProjection: {
        ...fixture.writerProjection,
        contentKeyBundle: currentContentKeyBundle,
      },
    };
    const localId = "rotation-recovery-unavailable-epoch-local";
    const behindReader = await createDocument("unavailable-epoch-behind");
    importSnapshot(behindReader, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behindReader,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const originalRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture: currentFixture,
      }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    // The persisted-state fast path fetches this projection only after the raw
    // response arrives; it must not turn the typed availability error into a
    // retryable null result.
    state.writerProjection = null;

    const error = await assertDocumentStoreCanRotateContentKey(state).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(isDocumentSyncUpdateIsolationError(error)).toBe(true);
    if (!isDocumentSyncUpdateIsolationError(error)) return;
    expect(error.stage).toBe("content_key");
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(true);
    expect(state.doc && getTextValue(state.doc)).toBe("survives key");
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, localId),
    ).toEqual(originalRecord);
  } finally {
    close();
  }
});
