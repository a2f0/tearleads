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
import { DocumentRawHistoryUnavailableError } from "../../../workflows/documents";
import { buildMaterializedDocumentSyncPlan } from "../../../workflows/documents/syncPlanMaterial";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { assertDocumentStoreCanRotateContentKey } from "./rotation";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";

test("raw recovery ignores a forged rotation baseline and replays original updates", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-forged-baseline",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const forgedDocument = await createDocument("rotation-recovery-remote");
    forgedDocument.getText("text").update("forged value");
    forgedDocument.commit();
    forgedDocument.getText("text").update("forged value hidden!!");
    forgedDocument.commit();
    expect(encodeVersionVector(forgedDocument)).toBe(
      encodeVersionVector(fixture.remoteDocument),
    );
    const forgedSnapshot = exportFullHistorySnapshot(forgedDocument);
    const forgedVectors = getUpdateVersionVectors(forgedSnapshot);
    const forgedPlan = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      localVersionVector: null,
      pendingUpdates: [
        createPendingUpdateRecord({
          id: "550e8400-e29b-41d4-a716-446655440445",
          sourceVersionVector: forgedVectors.partialEndVersionVector,
          updateData: bytesToBase64(forgedSnapshot),
          ...forgedVectors,
        }),
      ],
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.writerProjection,
    });
    const forgedResponse = await createSyncResponse(forgedPlan.plan, {
      acceptedOutgoingUpdateIds: [],
    });
    const rawResponse = {
      ...fixture.response,
      updates: [...fixture.response.updates, ...forgedResponse.updates],
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

    const baseline = await assertDocumentStoreCanRotateContentKey(state);

    const recovered = await createDocument("forged-baseline-reader");
    importSnapshot(recovered, baseline);
    expect(getTextValue(recovered)).toBe("survives key rotation");
  } finally {
    close();
  }
});

test("an unavailable raw-history epoch leaves durable document state unchanged", async () => {
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

    const error = await assertDocumentStoreCanRotateContentKey(state).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(DocumentRawHistoryUnavailableError);
    expect((error as DocumentRawHistoryUnavailableError).code).toBe(
      "document_raw_history_epoch_unavailable",
    );
    expect((error as DocumentRawHistoryUnavailableError).contentKeyEpoch).toBe(
      1,
    );
    expect(state.doc && getTextValue(state.doc)).toBe("survives key");
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, localId),
    ).toEqual(originalRecord);
  } finally {
    close();
  }
});
