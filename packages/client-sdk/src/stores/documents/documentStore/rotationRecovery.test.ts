import { expect, test } from "bun:test";
import { base64ToBytes } from "@symcrypt/encoding";
import {
  createDocument,
  getTextValue,
  importSnapshot,
  importUpdates,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { hasRecordedTerminalSyncFailures } from "../../../data/sqlite/documentPersistence";
import type { DocumentsRuntime } from "../types";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import {
  ensureDocumentStoreReady,
  relinkDocumentStore,
} from "./initialization";
import { setDocumentText } from "./mutations";
import {
  advancePendingBaseVersion,
  enqueuePendingUpdate,
  listPendingUpdates,
  pendingDeltaSinceBase,
  persistDocument,
} from "./persistence";
import { assertDocumentStoreCanRotateContentKey } from "./rotation";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";

test("a full-history preflight settles pending writes before returning its baseline", async () => {
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
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
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

    expect(syncCalls.count).toBe(1);
    expect(await listPendingUpdates(state)).toEqual([]);
    const freshReader = await createDocument("pending-rotation-reader");
    importSnapshot(freshReader, baseline);
    expect(getTextValue(freshReader)).toBe("pending local edit");
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

test("a text edit queued during rotation applies to the rebuilt document", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-queued-edit",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-queued-edit-local";
    const behindReader = await createDocument("rotation-queued-edit-behind");
    importSnapshot(behindReader, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behindReader,
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

    const recovery = assertDocumentStoreCanRotateContentKey(state);
    const localText = "queued local edit";
    const localWrite = setDocumentText(state, () => undefined, localText);

    await recovery;
    await localWrite;
    if (!state.doc) {
      throw new Error("Expected rebuilt document after rotation recovery");
    }

    expect(getTextValue(state.doc)).toBe(localText);
    expect(state.snapshot.text).toBe(getTextValue(state.doc));
    expect(state.pendingLocalWrites).toBe(0);
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

// The rotation preflight's terminal-failure handler carries the store
// generation: a teardown (row 21's discard) racing the recovery invalidates
// it, so a denied submit records nothing instead of resurrecting a failure
// row for a document whose rows were just deleted.
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
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);
  } finally {
    close();
  }
});
