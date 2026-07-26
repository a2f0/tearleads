import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportShallowSnapshot,
  getTextValue,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { createRemoteHistoryFixture } from "../../../../test/helpers/remoteHistoryFixture";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { DocumentsRuntime } from "../types";
import { ensureDocumentStoreReady } from "./initialization";
import { listPendingUpdates } from "./persistence";
import {
  isStaleHealSnapshotUnavailableError,
  recoverStaleHealFullHistory,
} from "./staleHealRecovery";
import { createDocumentStoreState } from "./state";

const ignoredPersistenceEffects = {
  emitPersistedDocument: () => undefined,
  registerDocumentIdentity: () => undefined,
};

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
      _documentId: string,
      request: DocumentSyncRequest,
    ): Promise<DocumentSyncResponse> => {
      if (input.syncCalls) {
        input.syncCalls.count += 1;
      }
      // The recovery pull must be read-only: it may never submit updates.
      expect(request.outgoingUpdates).toEqual([]);
      return { ...response, acceptedOutgoingUpdateIds: [] };
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
      peerScope: "stale-heal-recovery",
    },
    util: {
      log: () => undefined,
    },
  };
}

test("classifies only the blocked-heal snapshot failure", () => {
  expect(
    isStaleHealSnapshotUnavailableError(
      new Error(
        "Document content-key bundle is stale and no rotation snapshot is available to heal it",
      ),
    ),
  ).toBe(true);
  expect(
    isStaleHealSnapshotUnavailableError(
      new Error("Document stale-bundle recovery snapshot is empty"),
    ),
  ).toBe(false);
  expect(isStaleHealSnapshotUnavailableError(new Error("anything"))).toBe(
    false,
  );
  expect(isStaleHealSnapshotUnavailableError(null)).toBe(false);
});

test("a blocked heal rebuilds full history from the remote op log with op identity intact", async () => {
  const { close, execSql } = await createTestExecSql("stale-heal-recovery");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "stale-heal-recovery-local";

    // The broken state: only the bounded shallow snapshot survived local
    // persistence, so the heal's full-history baseline cannot be exported.
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: localId,
      containerId: "source-container",
      documentId: fixture.writerProjection.documentId,
      text: getTextValue(fixture.remoteDocument),
      loroSnapshot: bytesToBase64(
        exportShallowSnapshot(fixture.remoteDocument),
      ),
      accessEpoch: 1,
      effectiveAccessLevel: "admin",
      pendingBaseVersion: encodeVersionVector(fixture.remoteDocument),
    });

    const syncCalls = { count: 0 };
    const state = createDocumentStoreState(
      localId,
      createRuntime({ execSql, fixture, syncCalls }),
      sqlDocumentsPersistence,
      ignoredPersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    if (!state.doc) {
      throw new Error("Expected restarted document");
    }
    const shallowDoc = state.doc;
    expect(() => exportFullHistorySnapshot(shallowDoc)).toThrow(
      "shallow-restored state",
    );

    expect(await recoverStaleHealFullHistory(state)).toBe(true);

    expect(syncCalls.count).toBe(1);
    expect(state.staleHealHistoryRecoveryAttempts).toBe(1);
    if (!state.doc) {
      throw new Error("Expected rebuilt document");
    }
    // Full history is restored — exactly what the blocked heal was missing —
    // and content converges with the remote frontier.
    expect(() => {
      if (!state.doc) throw new Error("Expected rebuilt document");
      exportFullHistorySnapshot(state.doc);
    }).not.toThrow();
    expect(getTextValue(state.doc)).toBe("survives key rotation");
    // The read-only pull settles nothing from the durable queue.
    expect(await listPendingUpdates(state)).toEqual([]);
  } finally {
    close();
  }
});

test("recovery attempts are bounded and fail soft when the pull cannot run", async () => {
  const { close, execSql } = await createTestExecSql(
    "stale-heal-recovery-bounded",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "stale-heal-recovery-bounded-local";
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: localId,
      containerId: "source-container",
      documentId: fixture.writerProjection.documentId,
      text: getTextValue(fixture.remoteDocument),
      loroSnapshot: bytesToBase64(
        exportShallowSnapshot(fixture.remoteDocument),
      ),
      accessEpoch: 1,
      effectiveAccessLevel: "admin",
      pendingBaseVersion: encodeVersionVector(fixture.remoteDocument),
    });

    const syncCalls = { count: 0 };
    const state = createDocumentStoreState(
      localId,
      createRuntime({ execSql, fixture, online: false, syncCalls }),
      sqlDocumentsPersistence,
      ignoredPersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    // Offline: the pull cannot run, so recovery reports failure both times…
    expect(await recoverStaleHealFullHistory(state)).toBe(false);
    expect(await recoverStaleHealFullHistory(state)).toBe(false);
    expect(state.staleHealHistoryRecoveryAttempts).toBe(2);
    // …and the third call is refused outright without consuming the budget.
    expect(await recoverStaleHealFullHistory(state)).toBe(false);
    expect(state.staleHealHistoryRecoveryAttempts).toBe(2);
    expect(syncCalls.count).toBe(0);
  } finally {
    close();
  }
});
