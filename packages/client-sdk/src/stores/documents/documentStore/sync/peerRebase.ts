import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  versionVectorsEqual,
} from "@tearleads/loro";
import {
  type PeerRefusal,
  type PeerRefusalRecovery,
  planPeerRefusalRecovery,
} from "../../../../data/documents/shared/sync/peerRefusalRecovery";
import {
  DOCUMENTS_APP_KIND,
  type DocumentPeerRebaseOutcome,
  type DocumentPeerRebaser,
  type DocumentRecord,
  type DocumentsPersistence,
  importDocumentHistoryTailUpdates,
  peerRebaseChangedQueue,
  queuedRecoveryUpdate,
} from "../../../../workflows/documents";
import { requestDocumentStoreSync } from "../../registry";
import { importDurableDocumentHistory } from "../history/durableDocumentReload";
import { chainIdentityWrite } from "../identityWriteChain";
import { holdQueuedWritesFor } from "../localWriteQueue";
import { listPendingUpdates } from "../persistence";
import {
  type DocumentState,
  type DocumentStoreState,
  setReadySnapshot,
} from "../state";
import { storedDocumentPeer } from "../storedDocument";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

type InstallPeerRebase = NonNullable<DocumentsPersistence["installPeerRebase"]>;

interface PeerRebaseContext {
  readonly currentDoc: DocumentState;
  readonly currentRecord: DocumentRecord;
  readonly generation: DocumentStoreSyncGeneration;
  readonly install: InstallPeerRebase;
  readonly state: DocumentStoreState;
}

/**
 * The live document with every durable row merged in. Another runtime on
 * this database may have queued operations the live document never saw; the
 * install replaces every queued row, so its one update must carry them too.
 */
async function readMergedDocument(context: PeerRebaseContext) {
  const { currentDoc, state } = context;
  const [history, queued] = await Promise.all([
    state.persistence.loadHistoryRestoreState(
      state.runtime.infra.execSql,
      state.localId,
    ),
    listPendingUpdates(state),
  ]);
  const merged = currentDoc.fork();
  try {
    importDurableDocumentHistory(merged, history);
    importDocumentHistoryTailUpdates(
      merged,
      queued.map((row) => row.updateData),
    );
  } catch (error) {
    merged.free();
    throw error;
  }
  return { merged, queued };
}

function isUnchanged(context: PeerRebaseContext, readVersion: string) {
  const { currentDoc, currentRecord, generation, state } = context;
  return (
    isDocumentStoreSyncGenerationCurrent(state, generation) &&
    state.doc === currentDoc &&
    state.record?.documentId === currentRecord.documentId &&
    (state.record?.recoveryGeneration ?? 0) ===
      (currentRecord.recoveryGeneration ?? 0) &&
    versionVectorsEqual(encodeVersionVector(currentDoc), readVersion)
  );
}

function installForkInMemory(input: {
  readonly fork: DocumentState;
  readonly forkVersion: string;
  readonly peerSalt: string;
  readonly record: DocumentRecord;
  readonly state: DocumentStoreState;
}): void {
  const { fork, forkVersion, state } = input;
  state.record = {
    ...input.record,
    peerSalt: input.peerSalt,
    pendingBaseVersion: forkVersion,
    recoveryGeneration: (input.record.recoveryGeneration ?? 0) + 1,
    snapshotEndVersion: forkVersion,
  };
  state.pendingBaseVersion = forkVersion;
  state.doc = fork;
  // The install made every live operation durable in the fork's checkpoint.
  state.unsavedLocalEdits = false;
  setReadySnapshot(state, fork, state.snapshot.syncing);
}

/** What the recovery read, which its install must still find. */
interface RecoveryRead {
  readonly documentId: string;
  /** The live document's version when the recovery began. */
  readonly liveVersion: string;
  readonly queuedUpdateIds: readonly string[];
  /** The merged document's version, durable rows included. */
  readonly readVersion: string;
  readonly record: DocumentRecord;
}

function installFence(context: PeerRebaseContext, read: RecoveryRead) {
  return {
    expectedDocumentId: read.documentId,
    expectedRecoveryGeneration: read.record.recoveryGeneration ?? 0,
    queuedUpdateIds: read.queuedUpdateIds,
    readVersion: read.readVersion,
    scope: { appKind: DOCUMENTS_APP_KIND, localId: context.state.localId },
    stillCurrent: () => isUnchanged(context, read.liveVersion),
  };
}

async function installFork(
  context: PeerRebaseContext,
  read: RecoveryRead,
  rebase: Extract<PeerRefusalRecovery, { kind: "rebase" }>,
  peerSalt: string,
): Promise<DocumentPeerRebaseOutcome> {
  const { state } = context;
  const { fork } = rebase;
  let installed = false;
  try {
    const forkVersion = encodeVersionVector(fork);
    installed =
      (await context.install(state.runtime.infra.execSql, {
        ...installFence(context, read),
        checkpoint: {
          endVersionVector: forkVersion,
          snapshot: bytesToBase64(exportFullHistorySnapshot(fork)),
        },
        kind: "fork",
        pendingUpdate: queuedRecoveryUpdate(rebase),
        record: { kind: "document", peerSalt },
      })) && isUnchanged(context, read.liveVersion);
    // A store reset after the commit reloads the installed rows itself.
    if (!installed) return "superseded";
    installForkInMemory({
      fork,
      forkVersion,
      peerSalt,
      record: read.record,
      state,
    });
    return "rebased";
  } finally {
    if (!installed) fork.free();
  }
}

/**
 * Queue the lost operations again. The document, its record, and its pending
 * base stay as they are: the relay sends operations the document already
 * holds, so nothing in memory moves.
 */
async function installRelay(
  context: PeerRebaseContext,
  read: RecoveryRead,
  relay: Extract<PeerRefusalRecovery, { kind: "relay" }>,
): Promise<DocumentPeerRebaseOutcome> {
  const installed = await context.install(context.state.runtime.infra.execSql, {
    ...installFence(context, read),
    kind: "relay",
    pendingUpdate: queuedRecoveryUpdate(relay),
  });
  return installed && isUnchanged(context, read.liveVersion)
    ? "relayed"
    : "superseded";
}

async function recoverOnWriteChain(
  context: PeerRebaseContext,
  refusal: PeerRefusal,
  peerSalt: string,
  newPeer: `${number}`,
): Promise<DocumentPeerRebaseOutcome> {
  const { currentDoc, state } = context;
  const record = state.record;
  const documentId = context.currentRecord.documentId;
  const liveVersion = encodeVersionVector(currentDoc);
  if (!record || !documentId || !isUnchanged(context, liveVersion)) {
    return "superseded";
  }
  const { merged, queued } = await readMergedDocument(context);
  try {
    if (!isUnchanged(context, liveVersion)) return "superseded";
    const recovery = planPeerRefusalRecovery({
      live: merged,
      newPeer,
      pendingBases: [state.pendingBaseVersion, record.pendingBaseVersion],
      queued,
      refusal,
    });
    if (recovery.kind === "nothing_to_cut") return "nothing_to_cut";
    if (recovery.kind === "park") return "parked";
    const read = {
      documentId,
      liveVersion,
      queuedUpdateIds: queued.map((row) => row.id),
      readVersion: encodeVersionVector(merged),
      record,
    };
    return recovery.kind === "relay"
      ? await installRelay(context, read, recovery)
      : await installFork(context, read, recovery, peerSalt);
  } finally {
    merged.free();
  }
}

/**
 * Recover this store's document from a peer refusal: rebase its unsent
 * operations onto a fresh peer, or, when the server's history went
 * backwards, relay the operations the server lost or park until the owner's
 * device restores them. A rebase's fresh peer comes from a new random salt
 * the record keeps, so a reload writes on it too. The work waits behind
 * every queued local write and holds the write queue until the install
 * lands, so no edit runs between reading the document and replacing its
 * queue. A recovery that changed the queue, or that lost a race, asks for
 * the pass that sends the current queue; a park waits for the next trigger.
 */
async function recoverDocumentStoreFromPeerRefusal(
  context: PeerRebaseContext,
  refusal: PeerRefusal,
): Promise<DocumentPeerRebaseOutcome> {
  const { state } = context;
  const peerSalt = crypto.randomUUID();
  const newPeer = await storedDocumentPeer(state, peerSalt);
  const outcome = await holdQueuedWritesFor(state, () =>
    chainIdentityWrite(state, () =>
      recoverOnWriteChain(context, refusal, peerSalt, newPeer),
    ),
  );
  if (peerRebaseChangedQueue(outcome)) requestDocumentStoreSync(state);
  return outcome;
}

/** The pass's recovery hook, or none when the adapter cannot install one. */
export function documentStorePeerRebaser(
  context: Omit<PeerRebaseContext, "install">,
): DocumentPeerRebaser | undefined {
  const install = context.state.persistence.installPeerRebase;
  if (!install) return undefined;
  return (refusal) =>
    recoverDocumentStoreFromPeerRefusal({ ...context, install }, refusal);
}
