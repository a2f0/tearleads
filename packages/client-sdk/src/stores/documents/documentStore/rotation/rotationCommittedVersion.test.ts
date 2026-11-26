import { expect, test } from "bun:test";
import { decodeVersionVector, encodeVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { installRebuiltDocument } from "../history/historyRebuild";
import { ensureDocumentStoreReady } from "../initialization";
import { setDocumentText } from "../mutations";
import { listPendingUpdates } from "../persistence";
import { createDocumentStoreState, type DocumentStoreState } from "../state";
import { createStoredDocument } from "../storedDocument";
import { captureDocumentStoreSyncGeneration } from "../sync/syncGeneration";
import { assertDocumentStoreCanRotateContentKey } from "./index";
import { RotationRawHistoryVoids } from "./rotationRawHistoryJudge";
import { pullVerifiedRawHistoryForRotation } from "./rotationRawHistoryPull";

type ExecSql = Awaited<ReturnType<typeof createTestExecSql>>["execSql"];
type Fixture = Awaited<ReturnType<typeof createRemoteHistoryFixture>>;

function counters(version: string | null | undefined): Record<string, number> {
  return Object.fromEntries(decodeVersionVector(version).toJSON());
}

// A store holding the remote writer's two updates, with nothing on record
// as committed. Its server keeps every update a request sends and serves
// each of them again on every later pull.
async function openSyncedStore(execSql: ExecSql, fixture: Fixture) {
  const documentId = fixture.writerProjection.documentId;
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await persistFullHistoryDocument({
    doc: fixture.remoteDocument,
    documentId,
    execSql,
    localId: documentId,
  });
  const committed: DocumentSyncResponse["updates"] = [];
  const state = createDocumentStoreState(
    documentId,
    createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: (request, response) => {
        const outgoingIds = new Set(
          request.outgoingUpdates.map((update) => update.id),
        );
        committed.push(
          ...response.updates.filter((update) => outgoingIds.has(update.id)),
        );
        return {
          ...response,
          updates: [...fixture.response.updates, ...committed],
        };
      },
    }),
    sqlDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    documentId,
  );
  expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
  const stored = async () =>
    (await sqlDocumentsPersistence.loadDocument(execSql, documentId))
      ?.committedVersion;
  expect(await stored()).toBeUndefined();
  return { state, stored };
}

function readyDocument(state: DocumentStoreState) {
  if (!state.doc || !state.record) throw new Error("Expected a ready store");
  return { doc: state.doc, record: state.record };
}

// With nothing queued, only the rebuild's install raises the record. A queued
// ordinary edit is committed and raw history pulled again before the install,
// so the installed rebuild holds the edit as an update the server served.
for (const queuedEdit of [false, true]) {
  test(`a rotation records what its raw pull served (queued edit: ${queuedEdit})`, async () => {
    const { close, execSql } = await createTestExecSql(
      `rotation-committed-version-${queuedEdit}`,
    );
    try {
      const fixture = await createRemoteHistoryFixture();
      const { state, stored } = await openSyncedStore(execSql, fixture);
      if (queuedEdit) {
        await setDocumentText(state, () => undefined, "queued local edit");
        expect(await listPendingUpdates(state)).toHaveLength(1);
      }
      expect(await stored()).toBeUndefined();

      await assertDocumentStoreCanRotateContentKey(state);

      expect(await listPendingUpdates(state)).toEqual([]);
      const { doc } = readyDocument(state);
      const remote = counters(encodeVersionVector(fixture.remoteDocument));
      expect(Object.keys(remote)).toHaveLength(1);
      const own = doc.oplogVersion().get(doc.peerIdStr) ?? 0;
      expect(own > 0).toBe(queuedEdit);
      expect(counters(await stored())).toEqual(
        queuedEdit ? { ...remote, [doc.peerIdStr]: own } : remote,
      );
      doc.free();
      fixture.remoteDocument.free();
    } finally {
      close();
    }
  });
}

// No rotation installs a rebuild that holds an operation the server did not
// serve: a queued ordinary edit is committed and pulled again first. The
// install still records the version
// the raw pull served, not the rebuilt document's own version, so it stays
// right if a rebuild ever does hold more.
test("the rebuild install records only what the raw pull served", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-committed-version-served",
  );
  try {
    const fixture = await createRemoteHistoryFixture();
    const { state, stored } = await openSyncedStore(execSql, fixture);
    const { doc: liveDocument, record } = readyDocument(state);
    const generation = captureDocumentStoreSyncGeneration(state, liveDocument);
    if (!generation) throw new Error("Expected a current generation");
    const rebuilt = await createStoredDocument(state, record.peerSalt);
    const synced = await pullVerifiedRawHistoryForRotation({
      currentRecord: record,
      generation,
      leftOut: [],
      rebuiltDocument: rebuilt,
      state,
      voids: new RotationRawHistoryVoids(),
    });
    const servedVersion = encodeVersionVector(rebuilt);
    const remote = counters(encodeVersionVector(fixture.remoteDocument));
    expect(counters(servedVersion)).toEqual(remote);
    // One operation of this device's own that no response served.
    rebuilt.getText("text").update("unsent local edit");
    rebuilt.commit();
    const unsent = rebuilt.oplogVersion().get(rebuilt.peerIdStr) ?? 0;
    expect(unsent).toBeGreaterThan(0);
    expect(remote[rebuilt.peerIdStr]).toBeUndefined();

    await installRebuiltDocument({
      consumedPullContinuation: null,
      currentRecord: record,
      generation,
      rebuiltDoc: rebuilt,
      servedVersion,
      state,
      synced,
      writerProjectionGeneration: state.writerProjectionGeneration,
    });

    expect(state.doc).toBe(rebuilt);
    expect(state.record?.snapshotEndVersion).toBe(encodeVersionVector(rebuilt));
    expect(counters(await stored())).toEqual(remote);
    liveDocument.free();
    rebuilt.free();
    fixture.remoteDocument.free();
  } finally {
    close();
  }
});
