import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { setDocumentText } from "../mutations";
import { createDocumentStoreState } from "../state";
import { assertDocumentStoreCanRotateContentKey } from "./index";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";

test("a reused rotation proof covers only the unchanged document it proved", async () => {
  const { close, execSql } = await createTestExecSql("rotation-proof-reuse");
  try {
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-proof-reuse-local";
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const committed: DocumentSyncResponse["updates"] = [];
    let rawPulls = 0;
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: (request, response) => {
        if (request.historyMode === "raw") rawPulls += 1;
        const outgoingIds = new Set(
          request.outgoingUpdates.map((update) => update.id),
        );
        committed.push(
          ...response.updates.filter((update) => outgoingIds.has(update.id)),
        );
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

    const proven = await assertDocumentStoreCanRotateContentKey(state, "prove");
    expect(rawPulls).toBe(1);
    expect(await assertDocumentStoreCanRotateContentKey(state, "reuse")).toBe(
      proven,
    );
    expect(rawPulls).toBe(1);

    // `prove` never reuses, and its proof replaces the recorded one.
    const reproven = await assertDocumentStoreCanRotateContentKey(
      state,
      "prove",
    );
    expect(rawPulls).toBe(2);
    expect(await assertDocumentStoreCanRotateContentKey(state, "reuse")).toBe(
      reproven,
    );
    expect(rawPulls).toBe(2);

    // A local edit moves the version vector past the recorded snapshot.
    await setDocumentText(state, () => undefined, "Edited after the proof");
    const afterEdit = await assertDocumentStoreCanRotateContentKey(
      state,
      "reuse",
    );
    expect(rawPulls).toBeGreaterThan(2);
    expect(afterEdit).not.toBe(reproven);
    expect(state.snapshot.text).toBe("Edited after the proof");
  } finally {
    close();
  }
});
