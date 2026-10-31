import { expect, test } from "bun:test";
import {
  createDocumentStore,
  createDomainScope,
  type DocumentsRuntime,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { cloneDocumentsTestRuntime } from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createSyncRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

interface SyncCall {
  minLsn: string | null;
  outgoingUpdateCount: number;
}

/**
 * Create and settle one remote document, then reopen it as a restarted
 * process would, with the server-events connect attempt `pendingAttempt`
 * still awaiting its interest acknowledgement.
 */
async function restartWhileConnecting(label: string, pendingAttempt: number) {
  const persistence = createDocumentsPersistence();
  const syncCalls: SyncCall[] = [];
  const runtime = await createSyncRuntime(
    generateKemSeedAndKeyPair(),
    "root-container",
    {
      commitLsnForSyncCount: (syncCount) => `0/${syncCount * 10}`,
      syncCalls,
    },
  );
  const connected = cloneDocumentsTestRuntime(runtime, {
    state: { serverEventsConnectionGeneration: 1 },
  });
  const created = createDocumentStore(label, connected, persistence);
  created.updateRuntime(connected);
  await waitForCondition(
    () =>
      syncCalls.length === 1 &&
      persistence.getState().document?.lastCommitLsn === "0/10" &&
      !created.getSnapshot().syncing,
    "Initial document create did not settle.",
  );
  await getOrCreateDomainSyncCoordinator(
    runtime.state.domainScope,
  ).waitForIdle();

  const restarted = cloneDocumentsTestRuntime(connected, {
    state: {
      domainScope: createDomainScope(),
      events: [],
      serverEventsPendingConnectAttempt: pendingAttempt,
    },
  });
  const store = createDocumentStore(label, restarted, persistence);
  store.updateRuntime(restarted);
  await waitForCondition(
    () => store.getSnapshot().ready && !store.getSnapshot().syncing,
    "Restarted document did not initialize.",
  );
  const settle = () =>
    getOrCreateDomainSyncCoordinator(restarted.state.domainScope).waitForIdle();
  await settle();
  return { restarted, settle, store, syncCalls };
}

function withEvents(
  runtime: DocumentsRuntime,
  events: {
    serverEventsConnectionGeneration: number;
    serverEventsPendingConnectAttempt: number | undefined;
  },
): DocumentsRuntime {
  return cloneDocumentsTestRuntime(runtime, { state: events });
}

test("a document opened while connecting probes once, on the acknowledgement", async () => {
  const { restarted, settle, store, syncCalls } = await restartWhileConnecting(
    "startup-probe-acknowledged",
    7,
  );
  // The startup probe waits on the attempt in flight instead of running.
  expect(syncCalls).toHaveLength(1);

  // The acknowledgement advances the generation and arms the reconnect probe,
  // which covers the deferred startup probe: one request, not two.
  store.updateRuntime(
    withEvents(restarted, {
      serverEventsConnectionGeneration: 2,
      serverEventsPendingConnectAttempt: undefined,
    }),
  );
  await waitForCondition(
    () => syncCalls.length === 2 && !store.getSnapshot().syncing,
    "The acknowledgement did not revalidate the deferred document.",
  );
  await settle();
  expect(syncCalls).toHaveLength(2);
  expect(syncCalls[1]).toEqual({ minLsn: "0/10", outgoingUpdateCount: 0 });
});

test("a connect attempt that ends without an acknowledgement releases the startup probe", async () => {
  const { restarted, settle, store, syncCalls } = await restartWhileConnecting(
    "startup-probe-attempt-failed",
    7,
  );
  expect(syncCalls).toHaveLength(1);

  store.updateRuntime(
    withEvents(restarted, {
      serverEventsConnectionGeneration: 1,
      serverEventsPendingConnectAttempt: undefined,
    }),
  );
  await waitForCondition(
    () => syncCalls.length === 2 && !store.getSnapshot().syncing,
    "The failed attempt did not release the deferred startup probe.",
  );
  await settle();
  expect(syncCalls).toHaveLength(2);
  expect(syncCalls[1]).toEqual({ minLsn: "0/10", outgoingUpdateCount: 0 });
});

test("a later connect attempt does not inherit an earlier attempt's deferral", async () => {
  const { restarted, settle, store, syncCalls } = await restartWhileConnecting(
    "startup-probe-next-attempt",
    7,
  );
  expect(syncCalls).toHaveLength(1);

  // The runtime coalesced attempt 7's end with attempt 8's start; attempt 8
  // may never acknowledge either, so the probe cannot keep waiting.
  store.updateRuntime(
    withEvents(restarted, {
      serverEventsConnectionGeneration: 1,
      serverEventsPendingConnectAttempt: 8,
    }),
  );
  await waitForCondition(
    () => syncCalls.length === 2 && !store.getSnapshot().syncing,
    "A new attempt kept the earlier deferral waiting.",
  );
  await settle();
  expect(syncCalls).toHaveLength(2);
});
