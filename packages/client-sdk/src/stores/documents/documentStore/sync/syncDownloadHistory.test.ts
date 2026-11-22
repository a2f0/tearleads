import { expect, test } from "bun:test";
import { createDocument, importSnapshot } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { getDomainDownloadHistorySnapshot } from "../../../../data/sync/downloadHistory";
import { createContainerDocumentQueriesFromRuntime } from "../../../../workflows/container-contents/documentQueries";
import { createPrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState, type DocumentStoreState } from "../state";
import { finalizeDocumentSync } from "./syncFinalize";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { prepareDocumentOutgoingCoverage } from "./syncOutgoingCoverage";
import { requestRemoteDocumentSync } from "./syncRequest";

type Fixture = Awaited<ReturnType<typeof createRemoteHistoryFixture>>;

// The first step of a lane pass: settle outgoing coverage.
async function prepareCoverage(state: DocumentStoreState) {
  const currentDoc = state.doc;
  if (!currentDoc) throw new Error("Expected ready store");
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) throw new Error("Expected current generation");
  const prepared = await prepareDocumentOutgoingCoverage({
    currentDoc,
    generation,
    pendingUpdates: [],
    state,
  });
  if (!prepared) throw new Error("Expected prepared outgoing coverage");
  return { currentDoc, currentRecord: prepared.record, generation };
}

// One lane pass as the scheduled sync runs it: settle outgoing coverage,
// pull, then finalize.
async function pullOnce(state: DocumentStoreState, fixture: Fixture) {
  const { currentDoc, currentRecord, generation } =
    await prepareCoverage(state);
  const attempt = await requestRemoteDocumentSync({
    policyOperation: createPrincipalPolicyOperation(),
    currentDoc,
    currentRecord,
    encapsulationKeyPair: fixture,
    generation,
    pendingUpdates: [],
    state,
    unavailableWriterLogMessage: "unexpected unavailable writer",
  });
  if (!attempt) throw new Error("Expected a completed sync response");
  await finalizeDocumentSync(
    state,
    currentDoc,
    currentRecord,
    attempt,
    0,
    generation,
    [],
    false,
  );
  return attempt.synced.hasIncompletePull;
}

test("a discovered document's paged first pull is one download, recorded when its last page lands", async () => {
  const { close, execSql } = await createTestExecSql("download-history-pages");
  try {
    const fixture = await createRemoteHistoryFixture();
    const documentId = fixture.writerProjection.documentId;
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await queries.upsertDiscoveredDocuments([
      {
        accessEpoch: 1,
        containerId: "source-container",
        createdAt: "2026-11-22T00:00:00Z",
        documentId,
        linkedContainerIds: ["source-container"],
      },
    ]);
    let requests = 0;
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: async (_request, response) => {
        requests += 1;
        // The first page carries the content; the second only drains.
        return requests === 1
          ? { ...response, pullPage: { hasMore: true, nextCursor: "page-2" } }
          : {
              ...response,
              updates: [],
              pullPage: { hasMore: false, nextCursor: null },
            };
      },
    });
    const { domainScope } = runtime.state;
    const state = createDocumentStoreState(
      documentId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    state.syncLane = { requestSync: () => undefined } as NonNullable<
      typeof state.syncLane
    >;
    expect(await queries.listPendingDownloads()).toMatchObject([
      { documentId, reason: "initial" },
    ]);

    expect(await pullOnce(state, fixture)).toBe(true);
    expect(getDomainDownloadHistorySnapshot(domainScope).completed).toEqual([]);
    expect(await queries.listPendingDownloads()).toMatchObject([
      { documentId, reason: "continuation" },
    ]);

    expect(await pullOnce(state, fixture)).toBe(false);
    expect(await queries.listPendingDownloads()).toEqual([]);
    const summary = await queries.loadDocumentSummary(documentId, {
      requireHydrated: true,
    });
    expect(getDomainDownloadHistorySnapshot(domainScope).completed).toEqual([
      {
        containerId: "source-container",
        documentId,
        localId: documentId,
        objectKind: "document",
        title: summary?.title ?? "missing summary",
      },
    ]);
    state.doc?.free();
    fixture.remoteDocument.free();
  } finally {
    close();
  }
});

// Before its first pull the lane settles outgoing coverage; a document with
// nothing of its own to send must still read as never pulled.
test("a discovered document's single-page first pull is a download", async () => {
  const { close, execSql } = await createTestExecSql("download-history-single");
  try {
    const fixture = await createRemoteHistoryFixture();
    const documentId = fixture.writerProjection.documentId;
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await queries.upsertDiscoveredDocuments([
      {
        accessEpoch: 1,
        containerId: "source-container",
        createdAt: "2026-11-22T00:00:00Z",
        documentId,
        linkedContainerIds: ["source-container"],
      },
    ]);
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
    });
    const state = createDocumentStoreState(
      documentId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    state.syncLane = { requestSync: () => undefined } as NonNullable<
      typeof state.syncLane
    >;

    // Settling coverage alone leaves the shell queued and unhydrated.
    await prepareCoverage(state);
    expect(await queries.listPendingDownloads()).toMatchObject([
      { documentId, reason: "initial" },
    ]);
    expect(
      await queries.loadDocumentSummary(documentId, { requireHydrated: true }),
    ).toBeNull();

    expect(await pullOnce(state, fixture)).toBe(false);
    expect(await queries.listPendingDownloads()).toEqual([]);
    expect(
      getDomainDownloadHistorySnapshot(runtime.state.domainScope).completed,
    ).toMatchObject([
      { documentId, localId: documentId, objectKind: "document" },
    ]);
    state.doc?.free();
    fixture.remoteDocument.free();
  } finally {
    close();
  }
});

/**
 * Sync a document this device already stores, in one page or two, checking
 * the queue between pages, and return what the download history recorded.
 */
async function syncStoredDocument(name: string, paged: boolean) {
  const { close, execSql } = await createTestExecSql(name);
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = `${name}-local`;
    const documentId = fixture.writerProjection.documentId;
    const behind = await createDocument(`${name}-behind`);
    importSnapshot(behind, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behind,
      documentId,
      execSql,
      localId,
    });
    let requests = 0;
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      ...(paged
        ? {
            responseForRequest: async (_request, response) => {
              requests += 1;
              return requests === 1
                ? {
                    ...response,
                    pullPage: { hasMore: true, nextCursor: "page-2" },
                  }
                : {
                    ...response,
                    updates: [],
                    pullPage: { hasMore: false, nextCursor: null },
                  };
            },
          }
        : {}),
    });
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    const state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    state.syncLane = { requestSync: () => undefined } as NonNullable<
      typeof state.syncLane
    >;
    const history = () =>
      getDomainDownloadHistorySnapshot(runtime.state.domainScope).completed;

    expect(await queries.listPendingDownloads()).toEqual([]);
    if (paged) {
      expect(await pullOnce(state, fixture)).toBe(true);
      expect(await queries.listPendingDownloads()).toMatchObject([
        { localId, reason: "continuation" },
      ]);
      expect(history()).toEqual([]);
    }
    expect(await pullOnce(state, fixture)).toBe(false);
    expect(await queries.listPendingDownloads()).toEqual([]);
    state.doc?.free();
    fixture.remoteDocument.free();
    return { completed: history(), localId };
  } finally {
    close();
  }
}

test("a pull of a document already stored is a sync, not a download", async () => {
  const { completed } = await syncStoredDocument(
    "download-history-sync",
    false,
  );
  expect(completed).toEqual([]);
});

// The queue lists an update's remaining pages, so its last page leaves the
// queue the way any listed pull does: recorded once, as finished.
test("a paged update of a stored document is recorded when its last page lands", async () => {
  const { completed, localId } = await syncStoredDocument(
    "download-history-paged-sync",
    true,
  );
  expect(completed).toMatchObject([{ localId, objectKind: "document" }]);
});
