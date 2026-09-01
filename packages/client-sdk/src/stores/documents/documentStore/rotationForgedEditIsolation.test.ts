import { expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
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

test("rotation never settles an edit authored on a forged baseline", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-forged-baseline-local-edit",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const forgedDocument = await createDocument("rotation-recovery-remote");
    forgedDocument.getText("text").update("forged value");
    forgedDocument.commit();
    forgedDocument.getText("text").update("forged value hidden!!");
    forgedDocument.commit();
    const localId = "rotation-forged-baseline-local-edit";
    await persistFullHistoryDocument({
      doc: forgedDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });

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
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    await setDocumentText(state, () => undefined, "local edit after forged");
    const pendingBefore = await listPendingUpdates(state);
    expect(pendingBefore).toHaveLength(1);

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "unverified local history",
    );

    expect(requests).toEqual([{ historyMode: "raw", outgoingCount: 0 }]);
    expect(await listPendingUpdates(state)).toEqual(pendingBefore);
  } finally {
    close();
  }
});
