import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { DocumentsPersistence } from "../../../workflows/documents";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { chainIdentityWrite } from "./identityWriteChain";
import { ensureDocumentStoreReady } from "./initialization";
import { setDocumentText } from "./mutations";
import { listPendingUpdates } from "./persistence";
import { assertDocumentStoreCanRotateContentKey } from "./rotation";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";

test("rotation never settles a row appended after provenance verification", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-settlement-provenance-race",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-settlement-provenance-race-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const forgedDocument = await createDocument(
      "rotation-settlement-provenance-race-forged-pane",
    );
    forgedDocument.getText("text").update("forged pane baseline");
    forgedDocument.commit();
    const forgedBase = encodeVersionVector(forgedDocument);
    forgedDocument.getText("text").update("forged pane dependent edit");
    forgedDocument.commit();
    const forgedDelta = exportUpdatesSince(forgedDocument, forgedBase);
    const forgedVectors = getUpdateVersionVectors(forgedDelta);

    let armed = false;
    let armedReads = 0;
    let injected = false;
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      listPendingUpdates: async (...args) => {
        if (armed) {
          armedReads += 1;
          if (armedReads === 2) {
            injected = true;
            await sqlDocumentsPersistence.enqueuePendingUpdate(
              args[0],
              {
                localId,
                updateData: bytesToBase64(forgedDelta),
                ...forgedVectors,
              },
              {
                expectedDocumentId: fixture.writerProjection.documentId,
                expectedRecoveryGeneration: 0,
              },
            );
          }
        }
        return sqlDocumentsPersistence.listPendingUpdates(...args);
      },
    };
    const requests: Array<{
      historyMode: "raw" | undefined;
      outgoingCount: number;
    }> = [];
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture,
        requireRawHistory: false,
        responseForRequest: (request, response) => {
          requests.push({
            historyMode: request.historyMode,
            outgoingCount: request.outgoingUpdates.length,
          });
          return response;
        },
      }),
      persistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    await setDocumentText(state, () => undefined, "genuine local edit");
    armed = true;

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "changed after rotation provenance verification",
    );

    armed = false;
    expect(injected).toBe(true);
    expect(requests).toEqual([{ historyMode: "raw", outgoingCount: 0 }]);
    expect(await listPendingUpdates(state)).toHaveLength(2);
  } finally {
    close();
  }
});

test("rotation settlement waits for an in-flight sync identity write", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-settlement-identity-write-race",
  );
  let releaseCompetingWrite: () => void = () => {};
  const competingWriteBlocked = new Promise<void>((resolve) => {
    releaseCompetingWrite = resolve;
  });
  let reportCompetingWriteStarted: () => void = () => {};
  const competingWriteStarted = new Promise<void>((resolve) => {
    reportCompetingWriteStarted = resolve;
  });
  let reportSettlementPersistStarted: () => void = () => {};
  const settlementPersistStarted = new Promise<void>((resolve) => {
    reportSettlementPersistStarted = resolve;
  });
  let state: ReturnType<typeof createDocumentStoreState> | null = null;
  const competingWriteRef: { current: Promise<void> | null } = {
    current: null,
  };

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-settlement-identity-write-race-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: async (request, response) => {
        const currentState = state;
        if (
          request.outgoingUpdates.length > 0 &&
          !competingWriteRef.current &&
          currentState
        ) {
          // Hold the same critical section used by sync finalization's remote
          // import + history persist. Settlement must queue behind the whole
          // section, never snapshot its shared document halfway through.
          competingWriteRef.current = chainIdentityWrite(
            currentState,
            async () => {
              reportCompetingWriteStarted();
              await competingWriteBlocked;
            },
          );
          await competingWriteStarted;
        }
        return response;
      },
    });
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      commitDocumentMutation: async (...args) => {
        if (args[1].acceptedPendingUpdateIds.length > 0) {
          reportSettlementPersistStarted();
        }
        return sqlDocumentsPersistence.commitDocumentMutation(...args);
      },
    };
    state = createDocumentStoreState(
      localId,
      runtime,
      persistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    await setDocumentText(state, () => undefined, "local edit to settle");

    const recovery = assertDocumentStoreCanRotateContentKey(state);
    await competingWriteStarted;
    const settlementRacedIdentityWrite = await Promise.race([
      settlementPersistStarted.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    expect(settlementRacedIdentityWrite).toBe(false);

    releaseCompetingWrite();
    await competingWriteRef.current;
    await expect(recovery).rejects.toThrow(
      "Rotation raw-history recovery found unverified local history",
    );
    await settlementPersistStarted;
  } finally {
    releaseCompetingWrite();
    await competingWriteRef.current?.catch(() => undefined);
    close();
  }
});
