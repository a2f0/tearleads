import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  decodeVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  getTextValue,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import type { PeerRefusal } from "../../../../data/documents/shared/sync/peerRefusalRecovery";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { DocumentRecordRepository } from "../../../../data/persistence/documents/records";
import { createDomainScope } from "../../../../data/shared/domainScope";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import { committedUpdateVersions } from "../../../../workflows/documents";
import { openHistoryTestStore } from "../history/historyDurability.testFixtures";
import { setDocumentText } from "../mutations";
import { listPendingUpdates } from "../persistence";
import type { DocumentStoreState } from "../state";
import { documentStorePeerRebaser } from "./peerRebase";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

// No queued update may lower what a device knows is committed (#3263). One
// that sends a peer again from counter zero, as a republished history does,
// would by the queue alone make the device count
// nothing on that peer as committed: a frontier that fell would read as an
// ordinary one and the rebase would write committed operations again. The
// record's committed version, which the settlement below raised, prevents it.

const LOCAL_ID = "note";
const SCOPE = { appKind: "documents", localId: LOCAL_ID };

let execSql: ExecSql;
let close: () => void;

beforeEach(async () => {
  ({ close, execSql } = await createTestExecSql(
    "document-store-full-history-queue",
  ));
  await sqlDocumentsPersistence.ensureSchema(execSql);
});

afterEach(() => close());

/**
 * A remote note whose "base" the server acknowledged, with " more" queued
 * after it and the whole history queued again from counter zero.
 */
async function noteWithQueuedFullHistory() {
  const domainScope = createDomainScope();
  await openHistoryTestStore(
    execSql,
    LOCAL_ID,
    sqlDocumentsPersistence,
    "base",
    domainScope,
  );
  await execSql(
    "UPDATE documents SET document_id = 'remote-note' WHERE local_id = ?",
    [LOCAL_ID],
  );
  const repository = new DocumentRecordRepository(execSql);
  const expectedRecord = await sqlDocumentsPersistence.loadDocument(
    execSql,
    LOCAL_ID,
  );
  if (!expectedRecord) throw new Error("expected the stored note");
  const birth = await repository.listDocumentPendingUpdates(SCOPE);
  await sqlDocumentsPersistence.settleAcceptedPendingUpdates(execSql, {
    committedVersions: committedUpdateVersions(birth),
    expectedRecord,
    pendingUpdateIds: birth.map((row) => row.id),
  });
  const state = await reopen(domainScope);
  const recordPeer = state.doc?.peerIdStr;
  if (!state.doc || !recordPeer) throw new Error("expected a loaded note");
  const committed = encodeVersionVector(state.doc);
  await setDocumentText(state, () => undefined, "base more");
  const fullHistory = createPendingUpdateFields(exportAllUpdates(state.doc));
  if (!fullHistory) throw new Error("expected a full-history update");
  await repository.enqueueDocumentPendingUpdate(SCOPE, fullHistory);
  return { committed, domainScope, recordPeer, state };
}

function reopen(domainScope: object): Promise<DocumentStoreState> {
  return openHistoryTestStore(
    execSql,
    LOCAL_ID,
    sqlDocumentsPersistence,
    "",
    domainScope,
  );
}

function rebaser(state: DocumentStoreState) {
  const { doc, record } = state;
  const generation = captureDocumentStoreSyncGeneration(state, doc);
  if (!doc || !record || !generation) throw new Error("expected a ready store");
  const rebase = documentStorePeerRebaser({
    currentDoc: doc,
    currentRecord: record,
    generation,
    state,
  });
  if (!rebase) throw new Error("expected the SQL adapter to install rebases");
  return rebase;
}

function refusedAt(
  kind: PeerRefusal["kind"],
  peerId: string,
  committedEndCounter: number,
): PeerRefusal {
  return { kind, peerFrontiers: [{ committedEndCounter, peerId }] };
}

async function storedRecord() {
  const [record] = await execSql(
    `SELECT recovery_generation, peer_salt, committed_version
     FROM documents WHERE local_id = ?`,
    [LOCAL_ID],
  );
  return record;
}

async function storedCommittedVersion(): Promise<string> {
  const [{ committed_version: version } = {}] = await execSql(
    "SELECT committed_version FROM documents WHERE local_id = ?",
    [LOCAL_ID],
  );
  return String(version);
}

test("parks at a frontier that fell although a full history is queued", async () => {
  const { committed, domainScope, recordPeer, state } =
    await noteWithQueuedFullHistory();
  const liveDoc = state.doc;
  const queue = await listPendingUpdates(state);
  const before = await storedRecord();
  // The owner's seed claimed two operations of a peer this device saw four
  // of committed. Cutting there would write "se" again on a fresh peer.
  const fell = refusedAt("peer_owned", recordPeer, 2);

  expect(await rebaser(state)(fell)).toBe("parked");

  expect(state.doc).toBe(liveDoc);
  expect(await listPendingUpdates(state)).toEqual(queue);
  expect(await storedRecord()).toEqual(before);
  const committedVersion = await storedCommittedVersion();
  expect(versionVectorsEqual(committedVersion, committed)).toBe(true);

  // The record keeps what it saw committed across a reload.
  const reloaded = await reopen(domainScope);
  expect(await rebaser(reloaded)(fell)).toBe("parked");
  expect(reloaded.doc?.peerIdStr).toBe(recordPeer);

  // Once the owner's device restored the peer, the frontier covers what the
  // device knows, and it rebases only its unsent " more".
  const restored = decodeVersionVector(committed).get(recordPeer) ?? 0;
  expect(
    await rebaser(reloaded)(refusedAt("peer_owned", recordPeer, restored)),
  ).toBe("rebased");
  const fork = reloaded.doc;
  if (!fork) throw new Error("expected a rebased fork");
  expect(getTextValue(fork)).toBe("base more");
  expect(fork.oplogVersion().get(recordPeer)).toBe(restored);
  // The fork keeps the committed operations, so the record's version stays.
  expect(await storedCommittedVersion()).toBe(committedVersion);
});

test("has nothing to relay for a lost dependency a queued full history already sends", async () => {
  const { recordPeer, state } = await noteWithQueuedFullHistory();
  const liveDoc = state.doc;
  const queue = await listPendingUpdates(state);
  const before = await storedRecord();

  // The server lost the whole peer. The queue already sends it from zero,
  // and re-expressing it on a fresh peer would duplicate "base".
  const outcome = await rebaser(state)(
    refusedAt("dependency_uncommitted", recordPeer, 0),
  );

  expect(outcome).toBe("nothing_to_relay");
  expect(state.doc).toBe(liveDoc);
  expect(await listPendingUpdates(state)).toEqual(queue);
  expect(await storedRecord()).toEqual(before);
});
