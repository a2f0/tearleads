import { expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  getTextValue,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { documentVerdictJudge } from "../../../../data/documents/shared/sync/documentUpdateVerdict";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { DocumentRecordRepository } from "../../../../data/persistence/documents/records";
import {
  readRotationAvailability,
  writeRotationAvailabilityInTransaction,
} from "../../../../data/persistence/documents/records/rotationAvailabilityPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../../data/sqlite/sqlitePersistenceRuntime";
import type { DocumentsRuntime } from "../../types";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import {
  ensureDocumentStoreReady,
  relinkDocumentStore,
} from "../initialization";
import {
  advancePendingBaseVersion,
  enqueuePendingUpdate,
  listPendingUpdates,
  pendingDeltaSinceBase,
  persistDocument,
} from "../persistence";
import { createDocumentStoreState } from "../state";
import { assertDocumentStoreCanRotateContentKey } from "./index";

test("rotation commits pending writes before consecutive raw recoveries", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-pending",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-pending-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });

    const syncCalls = { count: 0 };
    const committedUpdates: DocumentSyncResponse["updates"] = [];
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: (request, response) => {
        const outgoingIds = new Set(
          request.outgoingUpdates.map((update) => update.id),
        );
        committedUpdates.push(
          ...response.updates.filter((update) => outgoingIds.has(update.id)),
        );
        return {
          ...response,
          updates: [...fixture.response.updates, ...committedUpdates],
        };
      },
      syncCalls,
    });
    const state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    if (!state.doc) {
      throw new Error("Expected full-history document");
    }
    state.doc.getText("text").update("pending local edit");
    const pendingUpdate = pendingDeltaSinceBase(state, state.doc);
    await enqueuePendingUpdate(state, pendingUpdate);
    await persistDocument(state, state.doc);
    advancePendingBaseVersion(state, state.doc);
    expect(await listPendingUpdates(state)).toHaveLength(1);

    const baseline = await assertDocumentStoreCanRotateContentKey(state);

    // Preliminary raw proof, ordinary settlement, then definitive raw pull.
    expect(syncCalls.count).toBe(3);
    expect(await listPendingUpdates(state)).toHaveLength(0);
    const freshReader = await createDocument("pending-rotation-reader");
    importSnapshot(freshReader, baseline);
    expect(getTextValue(freshReader)).toBe("pending local edit");

    // A different client can perform the next rotation from retained ordinary
    // history alone. It does not need this client's queue or first baseline.
    const nextLocalId = "rotation-recovery-next-client";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId: nextLocalId,
    });
    const nextState = createDocumentStoreState(
      nextLocalId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(nextState, () => undefined)).toBe(
      true,
    );
    const nextBaseline =
      await assertDocumentStoreCanRotateContentKey(nextState);
    expect(syncCalls.count).toBe(4);
    const nextReader = await createDocument("next-rotation-reader");
    importSnapshot(nextReader, nextBaseline);
    expect(getTextValue(nextReader)).toBe("pending local edit");
  } finally {
    close();
  }
});

// A local edit the pending base was advanced past without a queued update
// is a gap: no served update and no queued update carries it.
test("raw recovery rejects a local history gap no queued update carries", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-unqueued-gap",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-unqueued-gap-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });

    const submittedIds: string[][] = [];
    const historyModes: Array<"raw" | undefined> = [];
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture,
        responseForRequest: (request, response) => {
          submittedIds.push(request.outgoingUpdates.map((update) => update.id));
          historyModes.push(request.historyMode);
          return response;
        },
      }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    if (!state.doc) throw new Error("Expected full-history document");

    state.doc.getText("text").update("unqueued local edit");
    await persistDocument(state, state.doc);
    advancePendingBaseVersion(state, state.doc);
    expect(await listPendingUpdates(state)).toEqual([]);
    // A rebuild trying an update's absence that fails on the local gap, not
    // on its comparison, says nothing of that update.
    const trying = {
      deaths: 3,
      documentId: fixture.writerProjection.documentId,
      judge: documentVerdictJudge(),
      leftOut: [],
      status: "leavingOut",
      trying: ["left-out-update"],
    } as const;
    await writeRotationAvailabilityInTransaction(
      getClientSQLitePersistenceRuntime(execSql).db,
      { appKind: "documents", localId },
      trying,
      "2026-11-24T00:00:00.000Z",
    );

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "unverified local history",
    );
    expect(
      await readRotationAvailability(
        getClientSQLitePersistenceRuntime(execSql).db,
        { appKind: "documents", localId },
      ),
    ).toEqual(trying);

    expect(submittedIds).toHaveLength(1);
    expect(submittedIds[0]).toEqual([]);
    expect(historyModes).toEqual(["raw"]);
    expect(await listPendingUpdates(state)).toEqual([]);
    expect(state.doc && getTextValue(state.doc)).toBe("unqueued local edit");
  } finally {
    close();
  }
});

test("a clean full-history preflight pulls a newer committed remote frontier", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-remote-ahead",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-remote-ahead-local";
    const behindReader = await createDocument("rotation-behind-reader");
    importSnapshot(behindReader, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behindReader,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });

    const syncCalls = { count: 0 };
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({ execSql, fixture, syncCalls }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    const baseline = await assertDocumentStoreCanRotateContentKey(state);

    expect(syncCalls.count).toBe(1);
    const freshReader = await createDocument("remote-ahead-rotation-reader");
    importSnapshot(freshReader, baseline);
    expect(getTextValue(freshReader)).toBe("survives key rotation");
  } finally {
    close();
  }
});

test("rotation preflight fails closed offline and can retry once online", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-offline",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-offline-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });

    const syncCalls = { count: 0 };
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      online: false,
      syncCalls,
    });
    const state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "remote sync prerequisites are unavailable",
    );
    expect(syncCalls.count).toBe(0);

    state.runtime = {
      ...runtime,
      state: { ...runtime.state, online: true },
    };
    const baseline = await assertDocumentStoreCanRotateContentKey(state);
    expect(syncCalls.count).toBe(1);
    const freshReader = await createDocument("rotation-offline-retry-reader");
    importSnapshot(freshReader, baseline);
    expect(getTextValue(freshReader)).toBe("survives key rotation");
  } finally {
    close();
  }
});

test("an edit after preflight remains replayable after the new key metadata is persisted", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-preflight-window",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-preflight-window-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({ execSql, fixture }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    const baseline = await assertDocumentStoreCanRotateContentKey(state);
    if (!state.doc) {
      throw new Error("Expected document after rotation preflight");
    }

    // A user edit can resume while the unlink request is in flight. Its raw
    // Loro delta remains durable and starts exactly at the proven baseline.
    state.doc.getText("text").update("edit during unlink");
    const windowDelta = pendingDeltaSinceBase(state, state.doc);
    await enqueuePendingUpdate(state, windowDelta);
    await persistDocument(state, state.doc);
    advancePendingBaseVersion(state, state.doc);

    // The unlink response persists the new key epoch/manifest, but must not
    // consume that raw pending delta; the next sync encrypts it under this new
    // writer boundary.
    await relinkDocumentStore(
      state,
      {
        accessEpoch: 2,
        containerId: "remaining-container",
        contentKeyBundle: "new-content-key-bundle",
        documentId: fixture.writerProjection.documentId,
        documentKekTargets: "new-document-kek-targets",
        documentManifestBundle: "new-document-manifest",
        localId,
      },
      () => undefined,
    );
    const [pending] = await listPendingUpdates(state);
    expect(pending).toBeDefined();
    expect(state.record?.contentKeyBundle).toBe("new-content-key-bundle");

    const freshReader = await createDocument("preflight-window-reader");
    importSnapshot(freshReader, baseline);
    importUpdates(freshReader, [base64ToBytes(pending?.updateData ?? "")]);
    expect(getTextValue(freshReader)).toBe("edit during unlink");
  } finally {
    close();
  }
});

// Raw recovery is read-only and must not create a queued-write failure row.
// A teardown racing the request remains terminal for the captured generation.
test("a torn-down store records no rotation preflight failure", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-torn-down",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-torn-down-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });

    const baseRuntime = createRotationRecoveryRuntime({ execSql, fixture });
    let tearDownStore = () => {};
    const runtime = {
      ...baseRuntime,
      apiClient: {
        ...baseRuntime.apiClient,
        syncDocumentResult: async () => {
          // The concurrent discard lands while the submit is in flight.
          tearDownStore();
          return {
            message: "Write access denied by the server (403)",
            ok: false as const,
            report: () => {},
            status: 403,
          };
        },
      } as unknown as DocumentsRuntime["apiClient"],
    };
    const state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    if (!state.doc) {
      throw new Error("Expected full-history document");
    }
    state.doc.getText("text").update("doomed local edit");
    const pendingUpdate = pendingDeltaSinceBase(state, state.doc);
    await enqueuePendingUpdate(state, pendingUpdate);
    await persistDocument(state, state.doc);
    advancePendingBaseVersion(state, state.doc);
    tearDownStore = () => {
      (state as { doc: unknown }).doc = null;
    };

    await expect(
      assertDocumentStoreCanRotateContentKey(state),
    ).rejects.toThrow();
    expect(
      await new DocumentRecordRepository(
        execSql,
      ).hasRecordedTerminalSyncFailures(),
    ).toBe(false);
  } finally {
    close();
  }
});
