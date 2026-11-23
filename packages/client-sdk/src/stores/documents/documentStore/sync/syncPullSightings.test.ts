import { expect, test } from "bun:test";
import { createDocument, importSnapshot } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { createPrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState } from "../state";
import { readReplacedBindingSightings } from "./replacedBindingSightings";
import { finalizeDocumentSync } from "./syncFinalize";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";

const SLOT_ID = "photo";
const BINDING_ID = "binding-sighted-before-the-pull";

/**
 * A binding sighted for a removed slot is the slot's own only once a pull
 * that drained the server's updates has been applied after the sighting.
 */
for (const outcome of ["applied", "incomplete", "superseded"] as const) {
  test(`a pull that is ${outcome} ${outcome === "applied" ? "confirms" : "does not confirm"} an earlier binding sighting`, async () => {
    const { close, execSql } = await createTestExecSql(
      `document-pull-sightings-${outcome}`,
    );
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const fixture = await createRemoteHistoryFixture();
      const localId = `document-pull-sightings-${outcome}-local`;
      const documentId = fixture.writerProjection.documentId;
      const behind = await createDocument("document-pull-sightings-behind");
      importSnapshot(behind, fixture.behindSnapshot);
      await persistFullHistoryDocument({
        doc: behind,
        documentId,
        execSql,
        localId,
      });
      const runtime = createRotationRecoveryRuntime({
        execSql,
        fixture,
        requireRawHistory: false,
        responseForRequest: async (_request, response) => {
          if (outcome === "incomplete") {
            return {
              ...response,
              pullPage: {
                hasMore: true,
                nextCursor: "page-2",
                throughUpdateId: null,
              },
            };
          }
          if (outcome === "superseded") {
            // Another pane claims the pull first, so this response loses.
            const durable = await sqlDocumentsPersistence.loadDocument(
              execSql,
              localId,
            );
            if (!durable) throw new Error("Expected durable document");
            await sqlDocumentsPersistence.saveDocument(execSql, {
              ...durable,
              lastCommitLsn: "0/20",
              pullContinuation: {
                commitLsn: "0/20",
                commitLsnMode: "tracked",
                cursor: "other-pane-page-2",
              },
            });
          }
          return response;
        },
      });
      const state = createDocumentStoreState(
        localId,
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
      state.syncLane = { requestSync: () => undefined } as NonNullable<
        typeof state.syncLane
      >;
      const sightings = readReplacedBindingSightings(state, documentId);
      sightings.sight(SLOT_ID, BINDING_ID);

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
      expect(attempt.synced.hasIncompletePull).toBe(outcome === "incomplete");
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

      expect(sightings.confirmed(SLOT_ID)).toBe(
        outcome === "applied" ? BINDING_ID : undefined,
      );
      state.doc?.free();
      fixture.remoteDocument.free();
    } finally {
      close();
    }
  });
}
