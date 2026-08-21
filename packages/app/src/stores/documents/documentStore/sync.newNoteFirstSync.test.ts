import { expect, test } from "bun:test";
import {
  createDocumentStore,
  getOrCreateDomainSyncCoordinator,
} from "@symcrypt/client-sdk";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { cloneDocumentsTestRuntime } from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
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
// We reproduce the lag deterministically by gating enqueuePendingUpdate after
// it stores the first pending row: the first keystroke's write chain parks with
// the doc frozen at "a", we type ahead to "abcdef" (optimistic snapshot only,
// because the second write cannot start), then drive the sync. The pending row
// is already visible, so ensureRemoteDocument reads the lagging doc ("a") and
// persists the remote identity while the optimistic snapshot is ahead. The
// buggy code republishes "a" over "abcdef" before the local chain resumes.
//
// The store starts OFFLINE so the create is still pending when the burst begins:
// online, the eager pending-create flush would otherwise race the gate and can
// create the document before the first keystroke, dissolving the scenario (and
// the settle path uses saveDocumentAndDeletePendingUpdates, which this gate
// deliberately does not intercept). Flipping online mid-burst pins the original
// regression shape: the first online sync runs ensureRemoteDocument against the
// lagging doc while the durable mutation queue itself remains available.
test("new note first sync preserves the optimistic text while typing (online)", async () => {
  const basePersistence = createDocumentsPersistence();
  let blockEnqueues = false;
  let gatedEnqueueCount = 0;
  let releaseEnqueue: () => void = () => {};
  const enqueueGate = new Promise<void>((resolve) => {
    releaseEnqueue = resolve;
  });
  const persistence = {
    ...basePersistence,
    enqueuePendingUpdate: async (
      ...args: Parameters<typeof basePersistence.enqueuePendingUpdate>
    ) => {
      await basePersistence.enqueuePendingUpdate(...args);
      if (blockEnqueues) {
        gatedEnqueueCount += 1;
        await enqueueGate;
      }
    },
  };

  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "root-container",
  );
  const offlineRuntime = cloneDocumentsTestRuntime(runtime, {
    state: { online: false },
  });

  const store = createDocumentStore(
    "fast-typed-note",
    offlineRuntime,
    persistence,
  );
  store.updateRuntime(offlineRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "New-note document store did not become ready.",
  );

  // Record every published text so we can assert it never shrinks mid-burst.
  const publishedTexts: string[] = [];
  const unsubscribe = store.subscribe(() => {
    publishedTexts.push(store.getSnapshot().text);
  });

  // From here on, freeze the write chain after its pending row is durable so the
  // Loro doc lags without holding the serialized SQL mutation queue.
  blockEnqueues = true;

  // First keystroke: stores a pending update, then parks with the doc frozen at
  // "a" before its local document-record persist.
  store.setText("a");
  await waitForCondition(
    () => gatedEnqueueCount >= 1,
    "First keystroke did not reach the pending-update gate.",
  );

  // Type ahead while the doc is frozen: the optimistic snapshot jumps to
  // "abcdef" but the second write cannot start behind the parked first one.
  store.setText("abcdef");
  expect(store.getSnapshot().text).toBe("abcdef");

  // Go online, driving the first sync. It sees a pending update and no
  // documentId, so it runs ensureRemoteDocument against the lagging doc.
  store.updateRuntime(runtime);
  store.requestSync();
  await waitForCondition(
    () => store.getSnapshot().documentId !== null,
    "First sync did not persist the remote document identity.",
  );

  // Release the local write chain and let the store settle.
  blockEnqueues = false;
  releaseEnqueue();

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
