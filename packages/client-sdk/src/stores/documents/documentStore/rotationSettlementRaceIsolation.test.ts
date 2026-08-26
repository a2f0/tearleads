import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { DocumentsPersistence } from "../../../workflows/documents";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
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
              { expectedDocumentId: fixture.writerProjection.documentId },
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
