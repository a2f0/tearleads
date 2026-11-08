import { expect, test } from "bun:test";
import { createDocumentStore } from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { cloneDocumentsTestRuntime } from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createSyncRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

const KEYSTROKES = 230;

test("offline typing reconnects as one request carrying one update", async () => {
  const persistence = createDocumentsPersistence();
  const syncCalls: { minLsn: string | null; outgoingUpdateCount: number }[] =
    [];
  const runtime = await createSyncRuntime(
    generateKemSeedAndKeyPair(),
    "root-container",
    { syncCalls },
  );
  const offlineRuntime = cloneDocumentsTestRuntime(runtime, {
    state: { online: false },
  });
  const store = createDocumentStore(
    "offline-merged-note",
    offlineRuntime,
    persistence,
  );
  store.updateRuntime(offlineRuntime);
  await waitForCondition(
    () => store.getSnapshot().ready,
    "Offline note did not become ready.",
  );

  const typed = "x".repeat(KEYSTROKES);
  for (let length = 1; length <= KEYSTROKES; length += 1) {
    await store.setText(typed.slice(0, length));
  }
  expect(persistence.getState().pendingUpdates.length).toBeGreaterThanOrEqual(
    KEYSTROKES,
  );

  store.updateRuntime(runtime);
  store.requestSync();
  await waitForCondition(
    () =>
      store.getSnapshot().documentId !== null &&
      persistence.getState().pendingUpdates.length === 0 &&
      !store.getSnapshot().syncing,
    "Offline note did not sync after reconnecting.",
  );

  expect(
    syncCalls
      .map((call) => call.outgoingUpdateCount)
      .filter((count) => count > 0),
  ).toEqual([1]);
  expect(store.getSnapshot().text).toBe(typed);
});
