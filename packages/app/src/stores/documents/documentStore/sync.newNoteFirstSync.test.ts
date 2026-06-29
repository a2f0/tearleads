import { expect, test } from "bun:test";
import {
  createDocumentStore,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createSyncRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

// Regression for the "type immediately into a new note (online)" character loss.
//
// The first sync of a brand-new note runs ensureRemoteDocument to create it on
// the server, then persists the returned documentId/keys. That persist used to
// re-derive text from the Loro doc and republish it over the live optimistic
// snapshot. Because each keystroke advances the snapshot SYNCHRONOUSLY but the
// doc only on the async write chain (gated behind real DB writes), the doc lags
// the snapshot during a fast burst — so the create persist republished a SHORTER
// doc read, regressing the controlled <textarea> and dropping characters. Only
// online, because ensureRemoteDocument only runs inside an online sync pass.
//
// We reproduce the lag deterministically by gating saveDocument: the first
// keystroke's write chain parks at its persist (doc frozen at "a", a pending
// update already enqueued), we type ahead to "abcdef" (optimistic snapshot only,
// the second write cannot start while the first is parked), then drive the sync.
// ensureRemoteDocument reads the lagging doc ("a") and parks at its own persist.
// On release, the buggy code republishes "a" over "abcdef".
test("new note first sync preserves the optimistic text while typing (online)", async () => {
  const basePersistence = createDocumentsPersistence();
  let blockSaves = false;
  let gatedSaveCount = 0;
  let releaseSaves: () => void = () => {};
  const saveGate = new Promise<void>((resolve) => {
    releaseSaves = resolve;
  });
  const persistence = {
    ...basePersistence,
    saveDocument: async (
      ...args: Parameters<typeof basePersistence.saveDocument>
    ) => {
      if (blockSaves) {
        gatedSaveCount += 1;
        await saveGate;
      }
      return basePersistence.saveDocument(...args);
    },
  };

  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "root-container",
  );

  const store = createDocumentStore("fast-typed-note", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "New-note document store did not become ready.",
  );

  // Record every published text so we can assert it never shrinks mid-burst.
  const publishedTexts: string[] = [];
  const unsubscribe = store.subscribe(() => {
    publishedTexts.push(store.getSnapshot().text);
  });

  // From here on, freeze the write chain at its persist so the Loro doc lags.
  blockSaves = true;

  // First keystroke: enqueues a pending update, then parks at saveDocument with
  // the doc frozen at "a".
  store.setText("a");
  await waitForCondition(
    () => gatedSaveCount >= 1,
    "First keystroke persist did not reach the gated save.",
  );

  // Type ahead while the doc is frozen: the optimistic snapshot jumps to
  // "abcdef" but the second write cannot start behind the parked first one.
  store.setText("abcdef");
  expect(store.getSnapshot().text).toBe("abcdef");

  // Drive the first sync. It sees a pending update and no documentId, so it runs
  // ensureRemoteDocument, which reads the lagging doc ("a") and parks at its own
  // create persist.
  store.requestSync();
  await waitForCondition(
    () => gatedSaveCount >= 2,
    "First sync did not reach the new-document create persist.",
  );

  // Release everything and let the store settle.
  blockSaves = false;
  releaseSaves();

  await waitForCondition(
    () =>
      store.getSnapshot().documentId !== null &&
      persistence.getState().pendingUpdates.length === 0 &&
      !store.getSnapshot().syncing,
    "New note did not finish creating and syncing.",
  );
  await getOrCreateDomainSyncCoordinator(runtime.state.domainScope).waitForIdle(
    {
      quietMs: 20,
      timeoutMs: 2_000,
    },
  );
  unsubscribe();

  // Identity propagated, and the typed text survived.
  expect(store.getSnapshot().documentId).toBeString();
  expect(store.getSnapshot().text).toBe("abcdef");
  expect(persistence.getState().document?.text).toBe("abcdef");

  // The core invariant: a monotonic typing burst never publishes a shorter text.
  // The bug surfaces as an "abcdef" -> "a" republish, which violates this even if
  // a later pass heals the final value.
  for (let index = 1; index < publishedTexts.length; index += 1) {
    expect(publishedTexts[index]?.length ?? 0).toBeGreaterThanOrEqual(
      publishedTexts[index - 1]?.length ?? 0,
    );
  }
});
