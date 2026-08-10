import { expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  getTextValue,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
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
import { createDocumentStoreState } from "./state";

/**
 * Persist a document the way production does: content into the durable
 * history (checkpoint, no tail) and the record row carrying only the encoded
 * content frontier.
 */
async function persistFullHistoryDocument(input: {
  doc: Awaited<ReturnType<typeof createDocument>>;
  documentId: string;
  execSql: Parameters<typeof sqlDocumentsPersistence.saveDocument>[0];
  localId: string;
}): Promise<void> {
  const endVersion = encodeVersionVector(input.doc);
  await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(input.execSql, {
    coveredTailIds: [],
    endVersionVector: endVersion,
    force: true,
    localId: input.localId,
    snapshot: bytesToBase64(exportFullHistorySnapshot(input.doc)),
  });
  await sqlDocumentsPersistence.saveDocument(input.execSql, {
    id: input.localId,
    containerId: "source-container",
    documentId: input.documentId,
    text: getTextValue(input.doc),
    snapshotEndVersion: endVersion,
    accessEpoch: 1,
    effectiveAccessLevel: "admin",
    pendingBaseVersion: endVersion,
  });
}

function createRuntime(input: {
  fixture: Awaited<ReturnType<typeof createRemoteHistoryFixture>>;
  execSql: DocumentsRuntime["infra"]["execSql"];
  online?: boolean | undefined;
  syncCalls?: { count: number } | undefined;
}): DocumentsRuntime {
  const { author, publicKey, response, secretKey, signingPublicKey } =
    input.fixture;
  const apiClient = {
    getDocumentWriterProjection: async () => input.fixture.writerProjection,
    getUserIdentity: async () => null,
    syncDocument: async (
      documentId: string,
      request: DocumentSyncRequest,
    ): Promise<DocumentSyncResponse> => {
      if (input.syncCalls) {
        input.syncCalls.count += 1;
      }
      const echoedUpdates = request.outgoingUpdates.map((update) => ({
        accessEpoch: 1,
        ...(update.checkpointKind === undefined
          ? {}
          : { checkpointKind: update.checkpointKind }),
        ...(update.checkpointPayloadKind === undefined
          ? {}
          : { checkpointPayloadKind: update.checkpointPayloadKind }),
        authorFingerprint: author.signerKeyFingerprint,
        createdAt: "2026-04-27T00:00:00.000Z",
        documentId,
        encryptedData: update.encryptedData,
        id: update.id,
        partialEndVersionVector: update.partialEndVersionVector,
        partialStartVersionVector: update.partialStartVersionVector,
        plaintextHash: update.plaintextHash,
        ...(update.sourceVersionVector === undefined
          ? {}
          : { sourceVersionVector: update.sourceVersionVector }),
        writeHeader: update.writeHeader,
      }));
      return {
        ...response,
        acceptedOutgoingUpdateIds: request.outgoingUpdates.map(
          (update) => update.id,
        ),
        updates: [...response.updates, ...echoedUpdates],
      };
    },
  } as unknown as DocumentsRuntime["apiClient"];

  return {
    apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: author.organizationId,
      userId: author.signerUserId,
    },
    crypto: {
      encapsulationKeyPair: { publicKey, secretKey },
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: author.signerPrivateKey,
        signingPublicKey,
      },
    },
    infra: {
      blobStore: null as never,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
    },
    resolveTrustedUserIdentity: async (userId) =>
      userId === author.signerUserId
        ? createTestTrustedUserIdentity({
            encapsulationPublicKey: publicKey,
            signingKeyFingerprint: author.signerKeyFingerprint,
            signingPublicKey: signingPublicKey,
            userId,
          })
        : null,
    state: {
      containerId: "source-container",
      domainScope: createDomainScope(),
      events: [],
      online: input.online ?? true,
      peerScope: "rotation-recovery-restart",
    },
    util: {
      log: () => undefined,
    },
  };
}

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
    const runtime = createRuntime({ execSql, fixture, syncCalls });
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
      createRuntime({ execSql, fixture, syncCalls }),
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
      createRuntime({ execSql, fixture }),
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
    const runtime = createRuntime({
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
      createRuntime({ execSql, fixture }),
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

    const baseRuntime = createRuntime({ execSql, fixture });
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
