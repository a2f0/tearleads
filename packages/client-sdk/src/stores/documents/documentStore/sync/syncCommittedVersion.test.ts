import { expect, test } from "bun:test";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVector,
  exportUpdatesSince,
  getImportBlobMetadata,
  importSnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { planPeerRefusalRecovery } from "../../../../data/documents/shared/sync/peerRefusalRecovery";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import type { PendingUpdateRecord } from "../../../../data/persistence/documents/records";
import { createDocumentSyncLoroWindow } from "../../../../workflows/documents/sync/loroPassWindow";
import { documentSyncCommittedVersions } from "../../../../workflows/documents/sync/syncCommittedVersions";
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

// Residual 5 (#3263): an edit whose server acknowledgement was lost stays
// queued locally, so `unsentStart` still starts at 0. When a later pull serves
// a foreign edit that causally depends on it, causal closure records the
// unacknowledged edit as committed so a stale recreation relays or parks
// instead of throwing PeerRebaseCommittedCutError.
test("pulled updates causally close unacknowledged local operations into committedVersion", async () => {
  const deviceA = await createDocument("lost-ack-device-a");
  const deviceB = await createDocument("lost-ack-device-b");
  const deviceC = await createDocument("lost-ack-device-c");
  try {
    deviceA.setPeerId(11n);
    deviceB.setPeerId(22n);
    deviceC.setPeerId(33n);

    // Device A writes "alpha " (server commits it, ack is lost so it stays queued).
    const beforeA = encodeVersionVector(deviceA);
    deviceA.getText("text").insert(0, "alpha ");
    deviceA.commit();
    const aUpdate = exportUpdatesSince(deviceA, beforeA);
    const aMeta = getImportBlobMetadata(aUpdate);

    // Device B pulls A's edit and writes "beta " depending on A.
    deviceB.import(aUpdate);
    const beforeB = encodeVersionVector(deviceB);
    deviceB.getText("text").insert(6, "beta ");
    deviceB.commit();
    const bUpdate = exportUpdatesSince(deviceB, beforeB);
    const bMeta = getImportBlobMetadata(bUpdate);

    // Device C pulls B's edit and writes "gamma" depending transitively on A via B.
    deviceC.import(aUpdate);
    deviceC.import(bUpdate);
    const beforeC = encodeVersionVector(deviceC);
    deviceC.getText("text").insert(11, "gamma");
    deviceC.commit();
    const cUpdate = exportUpdatesSince(deviceC, beforeC);
    const cMeta = getImportBlobMetadata(cUpdate);

    // Device A pulls B and C (never re-served A because A advertised its own VV).
    deviceA.import(bUpdate);
    deviceA.import(cUpdate);

    const committedVersions = documentSyncCommittedVersions(
      {
        decryptedUpdates: [
          {
            partialEndVersionVector: bMeta.partialEndVersionVector,
            partialStartVersionVector: bMeta.partialStartVersionVector,
            updateData: bUpdate,
          },
          {
            partialEndVersionVector: cMeta.partialEndVersionVector,
            partialStartVersionVector: cMeta.partialStartVersionVector,
            updateData: cUpdate,
          },
        ],
        plan: {
          request: { outgoingUpdates: [] },
        },
        response: { acceptedOutgoingUpdateIds: [] },
      },
      deviceA,
    );

    expect(committedVersions).toHaveLength(1);
    const committed = counters(committedVersions[0]);
    expect(committed).toEqual({ "11": 6, "22": 5, "33": 5 });

    // A stale recreation loses A's peer (frontier 0) and another user owns it:
    // with causal closure, Device A parks cleanly instead of throwing
    // PeerRebaseCommittedCutError.
    const recovery = planPeerRefusalRecovery({
      committedVersion: committedVersions[0],
      live: deviceA,
      newPeer: "99",
      pendingBases: [beforeA],
      queued: [
        {
          partialEndVersionVector: aMeta.partialEndVersionVector,
          partialStartVersionVector: aMeta.partialStartVersionVector,
        },
      ],
      refusal: {
        kind: "peer_owned",
        peerFrontiers: [{ committedEndCounter: 0, peerId: "11" }],
      },
    });
    expect(recovery).toEqual({
      kind: "park",
      requiredPeers: new Map([["11", 6]]),
    });
  } finally {
    deviceA.free();
    deviceB.free();
    deviceC.free();
  }
});
