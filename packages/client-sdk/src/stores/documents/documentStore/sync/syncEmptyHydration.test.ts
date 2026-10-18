import { expect, test } from "bun:test";
import { emptyVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { createContainerDocumentQueriesFromRuntime } from "../../../../workflows/container-contents/documentQueries";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createRotationRecoveryRuntime } from "../rotation/rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "../state";
import { finalizeDocumentSync } from "./syncFinalize";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";

for (const hasMore of [false, true]) {
  test(`a zero-update initial pull reveals a blank note only when complete (hasMore=${hasMore})`, async () => {
    const { execSql, close } = await createTestExecSql("empty-pull-hydration");
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
          createdAt: "2026-10-13T00:00:00Z",
          documentId,
          linkedContainerIds: ["source-container"],
        },
      ]);
      const runtime = createRotationRecoveryRuntime({
        execSql,
        fixture,
        requireRawHistory: false,
        responseForRequest: async (_request, response) => ({
          ...response,
          updates: [],
          commitLsn: "0/20",
          pullPage: { hasMore, nextCursor: hasMore ? "page-2" : null },
        }),
      });
      const state = createDocumentStoreState(
        documentId,
        runtime,
        sqlDocumentsPersistence,
        noopDocumentStorePersistenceEffects,
        documentId,
      );
      expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
      const currentDoc = state.doc;
      const currentRecord = state.record;
      if (!currentDoc || !currentRecord)
        throw new Error("Expected ready store");
      const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
      if (!generation) throw new Error("Expected current generation");
      expect(
        await queries.loadDocumentSummary(documentId, {
          requireHydrated: true,
        }),
      ).toBeNull();
      const attempt = await requestRemoteDocumentSync({
        currentDoc,
        currentRecord,
        encapsulationKeyPair: fixture,
        generation,
        pendingUpdates: [],
        state,
        unavailableWriterLogMessage: "unexpected unavailable writer",
      });
      if (!attempt) throw new Error("Expected completed request");
      expect(attempt.synced.decryptedUpdates).toEqual([]);
      expect(attempt.synced.hasIncompletePull).toBe(hasMore);
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
      const record = await sqlDocumentsPersistence.loadDocument(
        execSql,
        documentId,
      );
      expect(record?.snapshotEndVersion).toBe(
        hasMore ? "" : emptyVersionVector(),
      );
      if (hasMore) {
        expect(
          await queries.loadDocumentSummary(documentId, {
            requireHydrated: true,
          }),
        ).toBeNull();
        expect(await queries.listPendingDownloads()).toMatchObject([
          { documentId, reason: "initial" },
        ]);
      } else {
        expect(
          await queries.loadDocumentSummary(documentId, {
            requireHydrated: true,
          }),
        ).toMatchObject({
          documentKind: "note",
          title: "Untitled note",
        });
        expect(await queries.listPendingDownloads()).toEqual([]);
      }
      state.doc?.free();
      fixture.remoteDocument.free();
    } finally {
      close();
    }
  });
}
