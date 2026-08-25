import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  getTextValue,
  getUpdateVersionVectors,
  importSnapshot,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
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
    response: await createSyncResponse(plan.plan, {
      acceptedOutgoingUpdateIds: [],
    }),
    snapshot,
    vectors,
  };
}

test("raw recovery ignores a forged rotation baseline and replays original updates", async () => {
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
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture,
        responseForRequest: () => rawResponse,
      }),
      sqlDocumentsPersistence,
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

    const baseline = await assertDocumentStoreCanRotateContentKey(state);

    const recovered = await createDocument("forged-baseline-reader");
    importSnapshot(recovered, baseline);
    expect(getTextValue(recovered)).toBe("survives key rotation");
    expect(await listPendingUpdates(state)).toHaveLength(1);
  } finally {
    close();
  }
});

test("settlement does not persist a returned baseline before raw recovery succeeds", async () => {
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

    expect(await listPendingUpdates(state)).toHaveLength(0);
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
