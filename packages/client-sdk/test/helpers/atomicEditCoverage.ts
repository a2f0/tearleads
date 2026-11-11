import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { sqlDocumentsPersistence as documents } from "../../src/data/persistence/documents/documentsPersistence";
import { noopDocumentStorePersistenceEffects } from "../../src/stores/documents/documentStore/documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../../src/stores/documents/documentStore/initialization";
import { createDocumentStoreState } from "../../src/stores/documents/documentStore/state";
import { captureDocumentStoreSyncGeneration } from "../../src/stores/documents/documentStore/sync/syncGeneration";
import { prepareDocumentOutgoingCoverage } from "../../src/stores/documents/documentStore/sync/syncOutgoingCoverage";
import { createFileBackedSql, openFileBackedSql } from "./fileBackedSql";
import { createCoverageFixture } from "./syncOutgoingCoverage";

export async function createAtomicEditFixture(name: string) {
  const db = await createFileBackedSql();
  const f = await createCoverageFixture(name, false, db);
  if (!f.state.record) throw new Error("Missing seeded record");
  const version = encodeVersionVector(f.document);
  await documents.saveDocument(db.execSql, {
    ...f.state.record,
    effectiveAccessLevel: "write",
    pendingBaseVersion: version,
  });
  await documents.replaceHistoryCheckpoint(db.execSql, {
    coveredTailIds: [],
    endVersionVector: version,
    force: true,
    localId: f.localId,
    snapshot: bytesToBase64(exportFullHistorySnapshot(f.document)),
  });
  f.state.record = await documents.loadDocument(db.execSql, f.localId);
  f.state.pendingBaseVersion = version;
  return { ...f, db, version };
}

export async function reopenAtomicEdit(
  f: Awaited<ReturnType<typeof createAtomicEditFixture>>,
) {
  // A new Worker and native SQLite connection read the same on-disk file.
  await f.db.close();
  const db = await openFileBackedSql(f.db.path);
  const state = createDocumentStoreState(
    f.localId,
    {
      ...f.state.runtime,
      infra: { ...f.state.runtime.infra, execSql: db.execSql },
    },
    documents,
    noopDocumentStorePersistenceEffects,
    "document-1",
  );
  if (!(await ensureDocumentStoreReady(state, () => {})))
    throw new Error("Reopen failed");
  if (!state.doc) throw new Error("Missing reopened document");
  return { db, state, document: state.doc };
}

export async function prepareAtomicCoverage(
  state: ReturnType<typeof createDocumentStoreState>,
): Promise<
  NonNullable<Awaited<ReturnType<typeof prepareDocumentOutgoingCoverage>>>
> {
  const currentDoc = state.doc;
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!currentDoc || !generation)
    throw new Error("Missing document generation");
  const pendingUpdates = await documents.listPendingUpdates(
    state.runtime.infra.execSql,
    state.localId,
  );
  const prepared = await prepareDocumentOutgoingCoverage({
    currentDoc,
    generation,
    pendingUpdates,
    state,
  });
  if (!prepared) throw new Error("Outgoing coverage unexpectedly refused");
  return prepared;
}
