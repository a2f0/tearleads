import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { withPrincipalPolicies } from "../../../../../test/helpers/workflows/principalPolicyServiceFixture";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { DocumentRecordRepository } from "../../../../data/persistence/documents/records";
import { createDomainScope } from "../../../../data/shared/domainScope";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import {
  type DocumentPeerRebaseOutcome,
  RemoteDocumentService,
} from "../../../../workflows/documents";
import { createPrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { openHistoryTestStore } from "../history/historyDurability.testFixtures";
import { setDocumentText } from "../mutations";
import { listPendingUpdates } from "../persistence";
import type { DocumentStoreState } from "../state";
import { storedDocumentPeer } from "../storedDocument";
import { documentStorePeerRebaser } from "./peerRebase";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";

const LOCAL_ID = "note";
const SCOPE = { appKind: "documents", localId: LOCAL_ID };

let execSql: ExecSql;
let close: () => void;

beforeEach(async () => {
  ({ close, execSql } = await createTestExecSql("document-store-peer-rebase"));
  await sqlDocumentsPersistence.ensureSchema(execSql);
});

afterEach(() => close());

function counters(state: DocumentStoreState): Map<string, number> {
  if (!state.doc) throw new Error("expected a loaded document");
  return new Map(state.doc.oplogVersion().toJSON());
}

/** A known remote note whose record peer wrote "base" and then " more". */
async function refusedNote(domainScope = createDomainScope()) {
  const born = await openHistoryTestStore(
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
  const state = await openHistoryTestStore(
    execSql,
    LOCAL_ID,
    sqlDocumentsPersistence,
    "",
    domainScope,
  );
  const recordPeer = state.doc?.peerIdStr;
  if (!recordPeer || born.doc?.peerIdStr !== recordPeer) {
    throw new Error("expected the reopened note on its record peer");
  }
  const committed = counters(state).get(recordPeer) ?? 0;
  await setDocumentText(state, () => undefined, "base more");
  return { committed, domainScope, recordPeer, state };
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

test("moves the refused edits onto a salted peer the record keeps", async () => {
  const { committed, domainScope, recordPeer, state } = await refusedNote();
  const liveDoc = state.doc;
  const generation = state.record?.recoveryGeneration ?? 0;
  // The queue extends the record peer past what the server committed.
  const refused = await listPendingUpdates(state);
  expect(
    refused.some(
      (row) =>
        (decodeVersionVector(row.partialEndVersionVector).get(recordPeer) ??
          0) > committed,
    ),
  ).toBe(true);

  const outcome = await rebaser(state)([
    { committedEndCounter: committed, peerId: recordPeer },
  ]);

  expect(outcome).toBe("rebased");
  const fork = state.doc;
  const peerSalt = state.record?.peerSalt;
  if (!fork || !peerSalt) throw new Error("expected an installed fork");
  expect(fork).not.toBe(liveDoc);
  expect(getTextValue(fork)).toBe("base more");
  expect(fork.peerIdStr).toBe(await storedDocumentPeer(state, peerSalt));
  expect(counters(state).get(recordPeer)).toBe(committed);
  expect(state.record?.recoveryGeneration).toBe(generation + 1);

  // One queued update replaces the refused queue, and it extends no refused
  // peer past what the server committed.
  const queued = await listPendingUpdates(state);
  expect(queued).toHaveLength(1);
  const sent = decodeVersionVector(queued[0]?.partialEndVersionVector ?? "");
  expect(sent.get(recordPeer) ?? 0).toBeLessThanOrEqual(committed);
  expect(
    versionVectorsEqual(
      queued[0]?.partialEndVersionVector ?? "",
      encodeVersionVector(fork),
    ),
  ).toBe(true);
  // The birth row never settled here, so the update still carries it.
  const from = decodeVersionVector(queued[0]?.partialStartVersionVector ?? "");
  expect(from.get(recordPeer) ?? 0).toBe(0);

  // A reload restores the fork's history and writes on the salted peer.
  const reopened = await openHistoryTestStore(
    execSql,
    LOCAL_ID,
    sqlDocumentsPersistence,
    "",
    domainScope,
  );
  expect(reopened.record?.peerSalt).toBe(peerSalt);
  expect(reopened.doc?.peerIdStr).toBe(fork.peerIdStr);
  expect(getTextValue(reopened.doc ?? fork)).toBe("base more");
  expect(
    versionVectorsEqual(
      encodeVersionVector(reopened.doc ?? fork),
      encodeVersionVector(fork),
    ),
  ).toBe(true);

  // The next edit writes on the salted peer, never the refused one.
  await setDocumentText(state, () => undefined, "base more!");
  const next = await listPendingUpdates(state);
  for (const row of next) {
    const end = decodeVersionVector(row.partialEndVersionVector);
    expect(end.get(recordPeer) ?? 0).toBeLessThanOrEqual(committed);
  }
});

test("finds nothing to cut when the server committed every refused edit", async () => {
  const { recordPeer, state } = await refusedNote();
  const liveDoc = state.doc;

  const outcome = await rebaser(state)([
    {
      committedEndCounter: counters(state).get(recordPeer) ?? 0,
      peerId: recordPeer,
    },
  ]);

  expect(outcome).toBe("nothing_to_cut");
  expect(state.doc).toBe(liveDoc);
  expect(state.record?.peerSalt).toBeUndefined();
});

test("carries edits another runtime queued that the live document lacks", async () => {
  const { committed, recordPeer, state } = await refusedNote();
  const live = state.doc;
  if (!live) throw new Error("expected a loaded document");
  // Another tab on this database appends to the note on its own peer.
  const otherTab = await createDocument("other-tab");
  otherTab.import(live.export({ mode: "update" }));
  const before = encodeVersionVector(otherTab);
  otherTab.getText("text").insert(9, " elsewhere");
  otherTab.commit();
  const fields = createPendingUpdateFields(
    exportUpdatesSince(otherTab, before),
  );
  if (!fields) throw new Error("expected another tab's update");
  await new DocumentRecordRepository(execSql).enqueueDocumentPendingUpdate(
    SCOPE,
    fields,
  );

  const outcome = await rebaser(state)([
    { committedEndCounter: committed, peerId: recordPeer },
  ]);

  expect(outcome).toBe("rebased");
  expect(getTextValue(state.doc ?? live)).toBe("base more elsewhere");
});

test("installs nothing once another runtime settled the queue the rebase read", async () => {
  const { committed, recordPeer, state } = await refusedNote();
  const liveDoc = state.doc;
  const generation = state.record?.recoveryGeneration ?? 0;
  const install = state.persistence.installPeerRebase;
  if (!install) throw new Error("expected the SQL adapter to install rebases");
  // Another tab's pass commits the queued edits after this rebase read them
  // as unsent, so the fork would replay operations now committed.
  const repository = new DocumentRecordRepository(execSql);
  state.persistence = {
    ...state.persistence,
    installPeerRebase: async (installExecSql, input) => {
      for (const row of await listPendingUpdates(state)) {
        await repository.settleDocumentPendingUpdate(row.id);
      }
      return install(installExecSql, input);
    },
  };

  const outcome = await rebaser(state)([
    { committedEndCounter: committed, peerId: recordPeer },
  ]);

  expect(outcome).toBe("superseded");
  expect(state.doc).toBe(liveDoc);
  expect(state.record?.peerSalt).toBeUndefined();
  expect(state.record?.recoveryGeneration ?? 0).toBe(generation);
  const [stored] = await execSql(
    "SELECT recovery_generation, peer_salt FROM documents WHERE local_id = ?",
    [LOCAL_ID],
  );
  expect(stored).toEqual({ peer_salt: null, recovery_generation: generation });
});

test("the store's sync pass hands its own rebase to the refused pass", async () => {
  const { committed, recordPeer, state } = await refusedNote();
  // A signed-in writer, so the pass resolves an author and submits.
  state.runtime = withPrincipalPolicies({
    ...state.runtime,
    apiClient: createMockApiClient({}),
    auth: { isAuthenticated: true, organizationId: "org", userId: "user" },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: "fingerprint",
      signingKeyPair: {
        signingPrivateKey: new Uint8Array(32),
        signingPublicKey: new Uint8Array(32),
      },
    },
  });
  const { doc, record } = state;
  const generation = captureDocumentStoreSyncGeneration(state, doc);
  if (!doc || !record || !generation) throw new Error("expected a ready store");
  // The pass refuses on the peer-owned code and hands its frontiers to the
  // hook; this stands in for that classification.
  let outcome: DocumentPeerRebaseOutcome | undefined;
  const pass = spyOn(
    RemoteDocumentService.prototype,
    "syncRemoteDocument",
  ).mockImplementation(async (request) => {
    outcome = await request.rebaseOntoFreshPeer?.([
      { committedEndCounter: committed, peerId: recordPeer },
    ]);
    return null;
  });
  try {
    const attempt = await requestRemoteDocumentSync({
      currentDoc: doc,
      currentRecord: record,
      encapsulationKeyPair: {
        publicKey: new Uint8Array(32),
        secretKey: new Uint8Array(32),
      },
      generation,
      pendingUpdates: await listPendingUpdates(state),
      policyOperation: createPrincipalPolicyOperation(),
      state,
      unavailableWriterLogMessage: "unexpected unavailable writer",
    });

    expect(pass).toHaveBeenCalledTimes(1);
    expect(attempt).toBeNull();
  } finally {
    pass.mockRestore();
  }
  expect(outcome).toBe("rebased");
  expect(state.doc).not.toBe(doc);
  expect(state.record?.peerSalt).toBeString();
});
