import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { settleWithin } from "../../../../test/helpers/remoteSyncWait";
import { waitFor } from "../../../../test/helpers/waitFor";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import {
  disposeDomainSyncCoordinator,
  getOrCreateDomainSyncCoordinator,
} from "../../../data/sync/syncCoordinator";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { setDocumentText } from "./mutations";
import { listPendingUpdates } from "./persistence";
import { getActiveDocumentRemoteWork } from "./remoteWork";
import { assertDocumentStoreCanRotateContentKey } from "./rotation";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";
import { registerDocumentStoreSyncLane } from "./sync";
import {
  captureDocumentStoreSyncLaneGeneration,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";

async function createState(
  execSql: Parameters<typeof persistFullHistoryDocument>[0]["execSql"],
  responseForRequest: Parameters<
    typeof createRotationRecoveryRuntime
  >[0]["responseForRequest"],
) {
  const fixture = await createRemoteHistoryFixture();
  const localId = "rotation-coordinator-local";
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await persistFullHistoryDocument({
    doc: fixture.remoteDocument,
    documentId: fixture.writerProjection.documentId,
    execSql,
    localId,
  });
  const runtime = createRotationRecoveryRuntime({
    execSql,
    fixture,
    requireRawHistory: false,
    responseForRequest,
  });
  const state = createDocumentStoreState(
    localId,
    runtime,
    sqlDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    fixture.writerProjection.documentId,
  );
  await ensureDocumentStoreReady(state, () => undefined);
  const coordinator = getOrCreateDomainSyncCoordinator(
    runtime.state.domainScope,
  );
  return { coordinator, state };
}

test("a sync lane yields to unrelated lanes while rotation is held, then resumes", async () => {
  const db = await createTestExecSql("rotation-does-not-hold-pump");
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { coordinator, state } = await createState(
    db.execSql,
    async (request, response) => {
      if (request.historyMode === "raw") {
        started.resolve();
        await release.promise;
      }
      return response;
    },
  );
  state.syncLane = registerDocumentStoreSyncLane(state, () =>
    captureDocumentStoreSyncLaneGeneration(state),
  );
  const recovery = assertDocumentStoreCanRotateContentKey(state);
  const unrelatedRan = Promise.withResolvers<void>();
  const unrelated = coordinator.registerLane("unrelated-document", {
    phase: "document",
    run: async () => unrelatedRan.resolve(),
  });
  try {
    await settleWithin(started.promise, "held rotation");
    state.syncLane.requestSync();
    unrelated.requestSync();
    await settleWithin(unrelatedRan.promise, "unrelated lane during rotation");
    const documentLane = () =>
      coordinator
        .getSnapshot()
        .lanes.find((lane) => lane.key === `documents:${state.localId}`);
    expect(documentLane()?.runCount).toBe(1);
    expect(documentLane()?.runAbandoned).toBe(false);
    expect(await coordinator.waitForIdle()).toBe(true);
    expect(documentLane()?.runCount).toBe(1);
    release.resolve();
    expect(await settleWithin(recovery, "rotation settlement")).toBeInstanceOf(
      Uint8Array,
    );
    await waitFor(
      () => (documentLane()?.runCount ?? 0) >= 2,
      "Document sync did not resume after rotation",
    );
    expect(await coordinator.waitForIdle()).toBe(true);
  } finally {
    release.resolve();
    await recovery.catch(() => undefined);
    disposeDomainSyncCoordinator(state.runtime.state.domainScope);
    db.close();
  }
});

test("a watchdog-abandoned sync cannot hold a later structural rotation", async () => {
  const db = await createTestExecSql("abandoned-sync-rotation-pump");
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let requests = 0;
  const committed: DocumentSyncResponse["updates"] = [];
  const { coordinator, state } = await createState(
    db.execSql,
    async (request, response) => {
      requests += 1;
      if (requests === 1) {
        started.resolve();
        await release.promise;
        throw new Error("Simulated stalled request failure");
      }
      const outgoingIds = new Set(
        request.outgoingUpdates.map((update) => update.id),
      );
      committed.push(
        ...response.updates.filter((update) => outgoingIds.has(update.id)),
      );
      const updates = new Map(
        [...response.updates, ...committed].map((update) => [
          update.id,
          update,
        ]),
      );
      return { ...response, updates: [...updates.values()] };
    },
  );
  const syncErrors: unknown[] = [];
  const registerLane = coordinator.registerLane;
  coordinator.registerLane = (key, config) =>
    registerLane(key, {
      ...config,
      onUnexpectedError: (error) => syncErrors.push(error),
      watchdogMs: 20,
    });
  state.syncLane = registerDocumentStoreSyncLane(state, () =>
    captureDocumentStoreSyncLaneGeneration(state),
  );
  coordinator.registerLane = registerLane;
  const rotationResult = Promise.withResolvers<unknown>();
  const structural = coordinator.registerLane("structural-rotation", {
    phase: "structural",
    run: async () => {
      rotationResult.resolve(
        await assertDocumentStoreCanRotateContentKey(state).catch(
          (error: unknown) => error,
        ),
      );
    },
  });
  const unrelatedRan = Promise.withResolvers<void>();
  const unrelated = coordinator.registerLane("another-document", {
    phase: "document",
    run: async () => unrelatedRan.resolve(),
  });
  try {
    markDocumentStoreRemoteSyncPending(state, "independent");
    state.syncLane.requestSync();
    await settleWithin(started.promise, "ordinary document sync");
    await waitFor(
      () => coordinator.getSnapshot().lanes.some((lane) => lane.runAbandoned),
      "Document sync watchdog did not abandon the held request",
    );
    await settleWithin(
      setDocumentText(state, () => undefined, "Still editable"),
      "local edit during abandoned request",
    );
    const pendingBefore = await listPendingUpdates(state);
    expect(pendingBefore.length).toBeGreaterThan(0);
    structural.requestSync();
    unrelated.requestSync();
    const result = await settleWithin(
      rotationResult.promise,
      "rotation behind abandoned sync",
    );
    expect(result).toBeInstanceOf(Error);
    expect(String(result)).toContain("remote work is still running");
    await settleWithin(unrelatedRan.promise, "unrelated lane after rotation");
    expect(await listPendingUpdates(state)).toEqual(pendingBefore);
    expect(state.snapshot.text).toBe("Still editable");
    expect(requests).toBe(1);
    state.runtime = {
      ...state.runtime,
      state: { ...state.runtime.state, online: false },
    };
    release.resolve();
    await waitFor(
      () => getActiveDocumentRemoteWork(state) === null,
      "Failed request did not release the document's remote work",
    );
    expect(await coordinator.waitForIdle()).toBe(true);
    expect(syncErrors).toHaveLength(1);
    expect(await listPendingUpdates(state)).toEqual(pendingBefore);
    state.runtime = {
      ...state.runtime,
      state: { ...state.runtime.state, online: true },
    };
    expect(
      await settleWithin(
        assertDocumentStoreCanRotateContentKey(state),
        "rotation retry after abandoned sync settles",
      ),
    ).toBeInstanceOf(Uint8Array);
    expect(state.snapshot.text).toBe("Still editable");
    expect(await listPendingUpdates(state)).toHaveLength(0);
  } finally {
    release.resolve();
    await coordinator.waitForIdle();
    disposeDomainSyncCoordinator(state.runtime.state.domainScope);
    db.close();
  }
});
