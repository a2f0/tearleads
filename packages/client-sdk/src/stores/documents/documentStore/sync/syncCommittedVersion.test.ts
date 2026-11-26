import { expect, test } from "bun:test";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVector,
  importSnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import type { PendingUpdateRecord } from "../../../../data/persistence/documents/records";
import { createDocumentSyncLoroWindow } from "../../../../workflows/documents/sync/loroPassWindow";
import { createPrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { setDocumentText } from "../mutations";
import { listPendingUpdates } from "../persistence";
import { createDocumentStoreState, type DocumentStoreState } from "../state";
import { finalizeDocumentSync } from "./syncFinalize";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { prepareDocumentOutgoingCoverage } from "./syncOutgoingCoverage";
import { requestRemoteDocumentSync } from "./syncRequest";

type Fixture = Awaited<ReturnType<typeof createRemoteHistoryFixture>>;

// One lane pass as the scheduled sync runs it: settle outgoing coverage,
// send the queue and pull, then finalize.
async function passOnce(
  state: DocumentStoreState,
  fixture: Fixture,
  queued: PendingUpdateRecord[],
): Promise<void> {
  const currentDoc = state.doc;
  if (!currentDoc) throw new Error("Expected ready store");
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) throw new Error("Expected current generation");
  const prepared = await prepareDocumentOutgoingCoverage({
    currentDoc,
    generation,
    pendingUpdates: queued,
    state,
  });
  if (!prepared) throw new Error("Expected prepared outgoing coverage");
  const attempt = await requestRemoteDocumentSync({
    loroWindow: createDocumentSyncLoroWindow(),
    policyOperation: createPrincipalPolicyOperation(),
    currentDoc,
    currentRecord: prepared.record,
    encapsulationKeyPair: fixture,
    generation,
    pendingUpdates: prepared.pendingUpdates,
    state,
    unavailableWriterLogMessage: "unexpected unavailable writer",
  });
  if (!attempt) throw new Error("Expected a completed sync response");
  await finalizeDocumentSync(
    state,
    currentDoc,
    prepared.record,
    attempt,
    0,
    generation,
    prepared.pendingUpdates.map((update) => update.id),
    false,
  );
}

function counters(version: string | null | undefined): Record<string, number> {
  return Object.fromEntries(decodeVersionVector(version).toJSON());
}

// The record's committed version has two sources, both written by the
// transaction that settles a sync response: the served updates the pass
// accepted, and the outgoing updates the server acknowledged.
test("a pull and an acknowledgement each raise what the record saw committed", async () => {
  const { close, execSql } = await createTestExecSql("sync-committed-version");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const documentId = fixture.writerProjection.documentId;
    // The device holds the remote writer's first update and may write.
    const behind = await createDocument("sync-committed-version-behind");
    importSnapshot(behind, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behind,
      documentId,
      execSql,
      localId: documentId,
    });
    behind.free();
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      // A pass that sends updates is answered with their acknowledgement
      // alone, so each source is seen on its own.
      responseForRequest: (request, response) =>
        request.outgoingUpdates.length > 0
          ? { ...response, updates: [] }
          : response,
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
    const stored = async () =>
      (await sqlDocumentsPersistence.loadDocument(execSql, documentId))
        ?.committedVersion;
    expect(await stored()).toBeUndefined();

    // The pull serves the remote writer's updates through its second.
    await passOnce(state, fixture, []);

    const remote = counters(encodeVersionVector(fixture.remoteDocument));
    expect(Object.keys(remote)).toHaveLength(1);
    expect(counters(await stored())).toEqual(remote);

    // A local edit is queued, not committed: the record does not move.
    await setDocumentText(state, () => undefined, "survives key rotation!");
    const queued = await listPendingUpdates(state);
    expect(queued).toHaveLength(1);
    expect(counters(await stored())).toEqual(remote);

    // The server acknowledges it.
    await passOnce(state, fixture, queued);

    expect(await listPendingUpdates(state)).toEqual([]);
    if (!state.doc) throw new Error("Expected the live document");
    const writer = state.doc.peerIdStr;
    expect(counters(await stored())).toEqual({
      ...remote,
      [writer]: state.doc.oplogVersion().get(writer) ?? 0,
    });
    state.doc.free();
    fixture.remoteDocument.free();
  } finally {
    close();
  }
});
