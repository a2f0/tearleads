import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
  listVersionVectorSpans,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import type { PeerRefusal } from "../../../../data/documents/shared/sync/peerRefusalRecovery";
import type { DocumentSyncSubmitFailure } from "../../../../data/documents/shared/sync/syncSubmitFailure";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { DocumentRecordRepository } from "../../../../data/persistence/documents/records";
import { createDomainScope } from "../../../../data/shared/domainScope";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import type { RemoteDocumentSyncPass } from "../../../../workflows/documents/sync/remoteDocumentSyncPass";
import { rebaseAfterPeerRefusal } from "../../../../workflows/documents/sync/syncPeerRebase";
import { openHistoryTestStore } from "../history/historyDurability.testFixtures";
import { setDocumentText } from "../mutations";
import { listPendingUpdates, saveDocumentRecord } from "../persistence";
import type { DocumentStoreState } from "../state";
import { documentStorePeerRebaser } from "./peerRebase";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { documentTerminalSubmitFailureHandler } from "./syncShared";

const LOCAL_ID = "note";
const SCOPE = { appKind: "documents", localId: LOCAL_ID };

let execSql: ExecSql;
let close: () => void;

beforeEach(async () => {
  ({ close, execSql } = await createTestExecSql(
    "document-store-peer-recovery",
  ));
  await sqlDocumentsPersistence.ensureSchema(execSql);
});

afterEach(() => close());

/**
 * A remote note whose "base" the server committed on the record peer, with
 * " more" queued after it. A stale recreation then loses the record peer.
 */
async function noteCommittedBeforeThePurge() {
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
  // The server accepted the birth, so its rows settle and stay as history.
  const repository = new DocumentRecordRepository(execSql);
  for (const row of await repository.listDocumentPendingUpdates(SCOPE)) {
    await repository.settleDocumentPendingUpdate(row.id);
  }
  const state = await openHistoryTestStore(
    execSql,
    LOCAL_ID,
    sqlDocumentsPersistence,
    "",
    domainScope,
  );
  const recordPeer = state.doc?.peerIdStr;
  if (!state.doc || !recordPeer) throw new Error("expected a loaded note");
  const committed = encodeVersionVector(state.doc);
  await setDocumentText(state, () => undefined, "base more");
  return { committed, domainScope, recordPeer, repository, state };
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

function lost(kind: PeerRefusal["kind"], peerId: string): PeerRefusal {
  return { kind, peerFrontiers: [{ committedEndCounter: 0, peerId }] };
}

async function storedRecord() {
  const [record] = await execSql(
    `SELECT recovery_generation, peer_salt, pending_base_version,
       sync_failure_message
     FROM documents WHERE local_id = ?`,
    [LOCAL_ID],
  );
  return record;
}

test("relays the operations a stale recreation lost under their own peer", async () => {
  const { committed, domainScope, recordPeer, state } =
    await noteCommittedBeforeThePurge();
  const liveDoc = state.doc;
  const before = await storedRecord();
  const end = encodeVersionVector(liveDoc ?? (await createDocument("none")));

  const outcome = await rebaser(state)(
    lost("dependency_uncommitted", recordPeer),
  );

  expect(outcome).toBe("relayed");
  // Nothing moved in memory or on the record: no fork, no fresh peer.
  expect(state.doc).toBe(liveDoc);
  expect(state.doc?.peerIdStr).toBe(recordPeer);
  expect(await storedRecord()).toEqual(before);
  // One update sends the whole record peer again, edit included, and keeps
  // what the device saw committed.
  const queued = await listPendingUpdates(state);
  expect(queued).toHaveLength(1);
  const [relay] = queued;
  if (!relay) throw new Error("expected the relay's update");
  expect(listVersionVectorSpans(relay)).toEqual([
    {
      endCounter: decodeVersionVector(end).get(recordPeer) ?? 0,
      peerId: recordPeer,
      startCounter: 0,
    },
  ]);
  expect(relay.committedVersionVector).toBe(committed);

  // A reload restores the same history on the same peer.
  const reopened = await openHistoryTestStore(
    execSql,
    LOCAL_ID,
    sqlDocumentsPersistence,
    "",
    domainScope,
  );
  if (!reopened.doc) throw new Error("expected the note to reopen");
  expect(getTextValue(reopened.doc)).toBe("base more");
  expect(reopened.doc.peerIdStr).toBe(recordPeer);
  expect(encodeVersionVector(reopened.doc)).toBe(end);
});

test("a relay carries what another runtime queued and loses none of it", async () => {
  const { domainScope, recordPeer, repository, state } =
    await noteCommittedBeforeThePurge();
  const live = state.doc;
  if (!live) throw new Error("expected a loaded document");
  // Another tab on this database appends on its own peer.
  const otherTab = await createDocument("other-tab");
  otherTab.import(live.export({ mode: "update" }));
  const from = encodeVersionVector(otherTab);
  otherTab.getText("text").insert(9, " elsewhere");
  otherTab.commit();
  const fields = createPendingUpdateFields(exportUpdatesSince(otherTab, from));
  if (!fields) throw new Error("expected another tab's update");
  await repository.enqueueDocumentPendingUpdateWithHistory(SCOPE, fields);

  const outcome = await rebaser(state)(
    lost("dependency_uncommitted", recordPeer),
  );

  expect(outcome).toBe("relayed");
  const [relay, ...others] = await listPendingUpdates(state);
  if (!relay || others.length > 0) throw new Error("expected one update");
  expect(
    listVersionVectorSpans(relay)
      .map(({ peerId }) => peerId)
      .sort(),
  ).toEqual([otherTab.peerIdStr, recordPeer].sort());
  const reopened = await openHistoryTestStore(
    execSql,
    LOCAL_ID,
    sqlDocumentsPersistence,
    "",
    domainScope,
  );
  if (!reopened.doc) throw new Error("expected the note to reopen");
  expect(getTextValue(reopened.doc)).toBe("base more elsewhere");
});

test("a relay keeps an edit made while it installs", async () => {
  const { recordPeer, state } = await noteCommittedBeforeThePurge();

  const [outcome] = await Promise.all([
    rebaser(state)(lost("dependency_uncommitted", recordPeer)),
    setDocumentText(state, () => undefined, "base more!"),
  ]);

  expect(["relayed", "superseded"]).toContain(outcome);
  if (!state.doc) throw new Error("expected a loaded document");
  expect(getTextValue(state.doc)).toBe("base more!");
  // Every operation the document holds past the lost frontier is queued.
  const sent = new Map<string, number>();
  for (const row of await listPendingUpdates(state)) {
    for (const span of listVersionVectorSpans(row)) {
      sent.set(
        span.peerId,
        Math.max(sent.get(span.peerId) ?? 0, span.endCounter),
      );
    }
  }
  expect(sent.get(recordPeer)).toBe(
    state.doc.oplogVersion().get(state.doc.peerIdStr),
  );
});

test("a superseded relay writes nothing", async () => {
  const { recordPeer, repository, state } = await noteCommittedBeforeThePurge();
  const install = state.persistence.installPeerRebase;
  if (!install) throw new Error("expected the SQL adapter to install rebases");
  // Another tab's pass commits the queued edit after this relay read it.
  state.persistence = {
    ...state.persistence,
    installPeerRebase: async (installExecSql, input) => {
      for (const row of await listPendingUpdates(state)) {
        await repository.settleDocumentPendingUpdate(row.id);
      }
      return install(installExecSql, input);
    },
  };
  const before = await storedRecord();

  const outcome = await rebaser(state)(
    lost("dependency_uncommitted", recordPeer),
  );

  expect(outcome).toBe("superseded");
  expect(await listPendingUpdates(state)).toEqual([]);
  expect(await storedRecord()).toEqual(before);
});

test("parks on a lost peer another user owns, reports it, and recovers", async () => {
  const { committed, recordPeer, state } = await noteCommittedBeforeThePurge();
  const liveDoc = state.doc;
  const generation = captureDocumentStoreSyncGeneration(state, liveDoc);
  if (!liveDoc || !generation) throw new Error("expected a ready store");
  const queue = await listPendingUpdates(state);
  const before = await storedRecord();
  const abandoned: string[] = [];
  const reported: string[] = [];
  const refusedPass = (refusal: PeerRefusal) =>
    rebaseAfterPeerRefusal(
      {
        onSyncAbandoned: (reason: string) => abandoned.push(reason),
        onTerminalSubmitFailure: documentTerminalSubmitFailureHandler(
          state,
          generation,
        ),
        rebaseOntoFreshPeer: rebaser(state),
      } as unknown as RemoteDocumentSyncPass,
      {
        failure: {
          message: "peer owned",
          ok: false,
          report: () => reported.push("refusal"),
          status: 409,
        } satisfies DocumentSyncSubmitFailure,
        refusal,
      },
    );

  // The owner's seed claimed the record peer below what this device saw
  // committed there.
  await refusedPass(lost("peer_owned", recordPeer));

  expect(state.doc).toBe(liveDoc);
  expect(await listPendingUpdates(state)).toEqual(queue);
  expect(abandoned).toEqual(["peer-restore-awaits-owner"]);
  expect(reported).toEqual([]);
  expect(await storedRecord()).toEqual({
    ...before,
    sync_failure_message:
      "The server lost committed history that only the document owner's devices may restore; queued changes sync afterwards",
  });
  // Still editable while parked.
  await setDocumentText(state, () => undefined, "base more, later");

  // The owner's device restored the peer up to what this device holds, so
  // the next refusal names that frontier and the device rebases past it.
  const restored = decodeVersionVector(committed).get(recordPeer) ?? 0;
  await refusedPass({
    kind: "peer_owned",
    peerFrontiers: [{ committedEndCounter: restored, peerId: recordPeer }],
  });

  const fork = state.doc;
  if (!fork || fork === liveDoc) throw new Error("expected a rebased fork");
  expect(getTextValue(fork)).toBe("base more, later");
  expect(fork.oplogVersion().get(recordPeer)).toBe(restored);
  const [rebased, ...others] = await listPendingUpdates(state);
  if (!rebased || others.length > 0) throw new Error("expected one update");
  expect(rebased.committedVersionVector).toBeUndefined();
  // The pass that lands the rebased queue clears the row, as any clean pass
  // clears a recorded failure.
  await saveDocumentRecord(
    state,
    fork,
    {},
    { acceptedPendingUpdateIds: [rebased.id], clearSyncFailure: true },
  );
  expect(await storedRecord()).toEqual(
    expect.objectContaining({ sync_failure_message: null }),
  );
  expect(await listPendingUpdates(state)).toEqual([]);
});
