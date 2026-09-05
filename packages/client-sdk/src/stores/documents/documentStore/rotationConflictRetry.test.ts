import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
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

test("rotation re-proves a re-keyed queue, bounds repeated changes and remains retryable", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-rekey-retry-limit",
  );
  try {
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-rekey-local";
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const committed: DocumentSyncResponse["updates"] = [];
    let rekey = true;
    let rawPulls = 0;
    let submissions = 0;
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: async (request, response) => {
        if (request.historyMode === "raw") rawPulls += 1;
        if (request.outgoingUpdates.length > 0) {
          submissions += 1;
          const outgoingIds = new Set(
            request.outgoingUpdates.map((update) => update.id),
          );
          committed.push(
            ...response.updates.filter((update) => outgoingIds.has(update.id)),
          );
          if (rekey) {
            for (const update of request.outgoingUpdates) {
              await sqlDocumentsPersistence.rekeyPendingUpdate(
                execSql,
                update.id,
              );
            }
          }
        }
        return {
          ...response,
          updates: [...fixture.response.updates, ...committed],
        };
      },
    });
    const state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    await ensureDocumentStoreReady(state, () => undefined);
    await setDocumentText(state, () => undefined, "Durable offline edit");
    const original = await listPendingUpdates(state);
    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "Document local updates changed after rotation provenance verification",
    );
    expect(rawPulls).toBe(3);
    expect(submissions).toBe(3);
    const pending = await listPendingUpdates(state);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).not.toBe(original[0]?.id);
    expect(pending[0]?.updateData).toBe(original[0]?.updateData);
    expect(state.snapshot.text).toBe("Durable offline edit");

    rekey = false;
    await assertDocumentStoreCanRotateContentKey(state);
    expect(await listPendingUpdates(state)).toHaveLength(0);
    expect(state.snapshot.text).toBe("Durable offline edit");
  } finally {
    close();
  }
});
