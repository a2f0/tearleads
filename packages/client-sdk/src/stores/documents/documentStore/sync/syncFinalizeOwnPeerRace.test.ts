import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
  importSnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { createDocumentSyncLoroWindow } from "../../../../workflows/documents/sync/loroPassWindow";
import { createPrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import {
  createRemoteHistoryFixture,
  createRemoteUpdatesResponse,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { setDocumentText } from "../mutations";
import { createDocumentStoreState } from "../state";
import { finalizeDocumentSync } from "./syncFinalize";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";

const FORGED_UPDATE_ID = "550e8400-e29b-41d4-a716-446655440d01";

test("an edit typed while a page that extends this device's own peer saves cannot reuse the page's operation ids", async () => {
  const { close, execSql } = await createTestExecSql("sync-own-peer-race");
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const claimed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let hold = false;
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "sync-own-peer-race-local";
    const behind = await createDocument("sync-own-peer-race-behind");
    importSnapshot(behind, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behind,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    let served = fixture.response;
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: async () => served,
    });
    const persistence = {
      ...sqlDocumentsPersistence,
      async loadDocument(
        ...args: Parameters<typeof sqlDocumentsPersistence.loadDocument>
      ) {
        if (hold) {
          hold = false;
          entered();
          await gate;
        }
        return sqlDocumentsPersistence.loadDocument(...args);
      },
    };
    const state = createDocumentStoreState(
      localId,
      runtime,
      persistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    const currentDoc = state.doc;
    const currentRecord = state.record;
    if (!currentDoc || !currentRecord)
      throw new Error("Expected initialized store");

    // Another holder of this device's peer writes at its next counters.
    const forger = await createDocument("sync-own-peer-race-forger");
    importSnapshot(forger, fixture.behindSnapshot);
    const before = encodeVersionVector(forger);
    forger.setPeerId(currentDoc.peerIdStr);
    forger.getText("text").insert(12, " FORGED");
    forger.commit();
    served = await createRemoteUpdatesResponse(fixture, [
      { id: FORGED_UPDATE_ID, update: exportUpdatesSince(forger, before) },
    ]);
    forger.free();

    const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
    if (!generation) throw new Error("Expected current generation");
    const attempt = await requestRemoteDocumentSync({
      loroWindow: createDocumentSyncLoroWindow(),
      policyOperation: createPrincipalPolicyOperation(),
      currentDoc,
      currentRecord,
      encapsulationKeyPair: fixture,
      generation,
      pendingUpdates: [],
      state,
      unavailableWriterLogMessage: "unexpected unavailable writer",
    });
    if (!attempt) throw new Error("Expected completed response");
    expect(attempt.synced.decryptedUpdates.map((update) => update.id)).toEqual([
      FORGED_UPDATE_ID,
    ]);

    hold = true;
    const finalized = finalizeDocumentSync(
      state,
      currentDoc,
      currentRecord,
      attempt,
      0,
      generation,
      [],
      false,
    );
    let localWrite = Promise.resolve();
    try {
      await claimed;
      localWrite = setDocumentText(
        state,
        () => undefined,
        "survives key LOCAL",
      );
      expect(state.snapshot.text).toBe("survives key LOCAL");
      // Let the queued write run as far as it can before the save resumes.
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The edit waits: the device's peer still holds none of its own ops.
      expect(currentDoc.oplogVersion().get(currentDoc.peerIdStr)).toBe(
        undefined,
      );
    } finally {
      release();
    }
    await finalized;
    await localWrite;

    const liveDoc = state.doc;
    if (!liveDoc) throw new Error("Expected a live document");
    // The page's seven operations, then the edit's, on the one peer.
    expect(liveDoc.oplogVersion().get(liveDoc.peerIdStr)).toBeGreaterThan(7);
    expect(getTextValue(liveDoc)).toBe("survives key LOCAL");
    expect(state.snapshot.text).toBe("survives key LOCAL");
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, localId))?.text,
    ).toBe("survives key LOCAL");

    const reopened = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(reopened, () => undefined)).toBe(
      true,
    );
    if (!reopened.doc) throw new Error("Expected a reopened document");
    expect(getTextValue(reopened.doc)).toBe("survives key LOCAL");
  } finally {
    release();
    close();
  }
});
