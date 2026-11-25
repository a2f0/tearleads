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

type Fixture = Awaited<ReturnType<typeof createRemoteHistoryFixture>>;

/**
 * A store holding "survives key", whose next pull serves an update another
 * holder of this device's peer wrote at the peer's next counters. Its saves
 * wait at `gate` once `holdNextSave` is called.
 */
async function openStoreServedOwnPeerPage(name: string) {
  const { close, execSql } = await createTestExecSql(name);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const claimed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let hold = false;
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const fixture: Fixture = await createRemoteHistoryFixture();
  const localId = `${name}-local`;
  const behind = await createDocument(`${name}-behind`);
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
  const open = (persistence = sqlDocumentsPersistence) =>
    createDocumentStoreState(
      localId,
      runtime,
      persistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
  const state = open({
    ...sqlDocumentsPersistence,
    async loadDocument(...args) {
      if (hold) {
        hold = false;
        entered();
        await gate;
      }
      return sqlDocumentsPersistence.loadDocument(...args);
    },
  });
  expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
  if (!state.doc) throw new Error("Expected initialized store");

  const forger = await createDocument(`${name}-forger`);
  importSnapshot(forger, fixture.behindSnapshot);
  const before = encodeVersionVector(forger);
  forger.setPeerId(state.doc.peerIdStr);
  forger.getText("text").insert(12, " FORGED");
  forger.commit();
  served = await createRemoteUpdatesResponse(fixture, [
    { id: FORGED_UPDATE_ID, update: exportUpdatesSince(forger, before) },
  ]);
  forger.free();

  /** One pass's request, judged against the store's document as it is now. */
  const pull = async () => {
    const currentDoc = state.doc;
    const currentRecord = state.record;
    if (!currentDoc || !currentRecord)
      throw new Error("Expected initialized store");
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
    const finalize = () =>
      finalizeDocumentSync(
        state,
        currentDoc,
        currentRecord,
        attempt,
        0,
        generation,
        [],
        false,
      );
    return { attempt, currentDoc, finalize };
  };
  const durableText = async () =>
    (await sqlDocumentsPersistence.loadDocument(execSql, localId))?.text;
  return {
    claimed,
    close: () => {
      release();
      close();
    },
    durableText,
    holdNextSave: () => {
      hold = true;
    },
    open,
    pull,
    release,
    state,
  };
}

test("an edit typed while a page that extends this device's own peer saves cannot reuse the page's operation ids", async () => {
  const store = await openStoreServedOwnPeerPage("sync-own-peer-race");
  const { state } = store;
  try {
    const { attempt, currentDoc, finalize } = await store.pull();
    expect(attempt.synced.decryptedUpdates.map((update) => update.id)).toEqual([
      FORGED_UPDATE_ID,
    ]);

    store.holdNextSave();
    const finalized = finalize();
    let localWrite = Promise.resolve();
    try {
      await store.claimed;
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
      store.release();
    }
    await finalized;
    await localWrite;

    const liveDoc = state.doc;
    if (!liveDoc) throw new Error("Expected a live document");
    // The page's seven operations, then the edit's, on the one peer.
    expect(liveDoc.oplogVersion().get(liveDoc.peerIdStr)).toBeGreaterThan(7);
    expect(getTextValue(liveDoc)).toBe("survives key LOCAL");
    expect(state.snapshot.text).toBe("survives key LOCAL");
    expect(await store.durableText()).toBe("survives key LOCAL");

    const reopened = store.open();
    expect(await ensureDocumentStoreReady(reopened, () => undefined)).toBe(
      true,
    );
    if (!reopened.doc) throw new Error("Expected a reopened document");
    expect(getTextValue(reopened.doc)).toBe("survives key LOCAL");
  } finally {
    store.close();
  }
});

test("an edit that ran before the page leaves the pass unapplied, and the next pass voids the page's update", async () => {
  const store = await openStoreServedOwnPeerPage("sync-own-peer-first");
  const { state } = store;
  try {
    // Judged before the edit: the update joins the history it was read on.
    const judgedFirst = await store.pull();
    expect(judgedFirst.attempt.synced.voidedUpdates).toEqual([]);
    await setDocumentText(state, () => undefined, "survives key LOCAL");
    const savedBefore = await store.durableText();

    await judgedFirst.finalize();

    // Nothing of the page was saved or applied, and nothing was thrown.
    expect(getTextValue(judgedFirst.currentDoc)).toBe("survives key LOCAL");
    expect(await store.durableText()).toBe(savedBefore);

    const judgedAgain = await store.pull();
    expect(judgedAgain.attempt.synced.decryptedUpdates).toEqual([]);
    expect(
      judgedAgain.attempt.synced.voidedUpdates.map((voided) => voided.updateId),
    ).toEqual([FORGED_UPDATE_ID]);
    await judgedAgain.finalize();
    expect(getTextValue(judgedFirst.currentDoc)).toBe("survives key LOCAL");
    expect(await store.durableText()).toBe("survives key LOCAL");
  } finally {
    store.close();
  }
});
