import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  versionVectorsEqual,
} from "@tearleads/loro";
import type { DocumentPeerFrontier } from "@tearleads/validators/response";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import {
  rebaseOntoFreshPeer,
  unsentStartOf,
} from "../../../../data/documents/shared/sync/peerRebase";
import {
  DOCUMENTS_APP_KIND,
  type DocumentPeerRebaseOutcome,
  type DocumentPeerRebaser,
  type DocumentRecord,
  type DocumentsPersistence,
  importDocumentHistoryTailUpdates,
} from "../../../../workflows/documents";
import { requestDocumentStoreSync } from "../../registry";
import { importDurableDocumentHistory } from "../history/durableDocumentReload";
import { chainIdentityWrite } from "../identityWriteChain";
import { chainQueuedWrite } from "../localWriteQueue";
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
 * install deletes every row, so the fork must carry them too.
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

async function rebaseOnWriteChain(
  context: PeerRebaseContext,
  peerFrontiers: readonly DocumentPeerFrontier[],
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
    const rebase = rebaseOntoFreshPeer({
      live: merged,
      newPeer,
      refusedFrontiers: new Map(
        peerFrontiers.map((frontier) => [
          frontier.peerId,
          frontier.committedEndCounter,
        ]),
      ),
      unsentStart: unsentStartOf({
        liveVersion: encodeVersionVector(merged),
        pendingBases: [state.pendingBaseVersion, record.pendingBaseVersion],
        queued,
      }),
    });
    if (rebase.kind === "nothing_to_cut") return "nothing_to_cut";
    const { fork } = rebase;
    const forkVersion = encodeVersionVector(fork);
    const pendingUpdate = createPendingUpdateFields(rebase.update);
    if (!pendingUpdate) {
      fork.free();
      throw new Error("Peer rebase produced no update to send");
    }
    const installed = await context.install(state.runtime.infra.execSql, {
      checkpoint: {
        endVersionVector: forkVersion,
        snapshot: bytesToBase64(exportFullHistorySnapshot(fork)),
      },
      expectedDocumentId: documentId,
      expectedRecoveryGeneration: record.recoveryGeneration ?? 0,
      pendingUpdate,
      readVersion: encodeVersionVector(merged),
      record: { kind: "document", peerSalt },
      scope: { appKind: DOCUMENTS_APP_KIND, localId: state.localId },
      stillCurrent: () => isUnchanged(context, liveVersion),
    });
    if (!installed || !isUnchanged(context, liveVersion)) {
      // A store reset after the commit reloads the installed rows itself.
      fork.free();
      return "superseded";
    }
    installForkInMemory({ fork, forkVersion, peerSalt, record, state });
    return "rebased";
  } finally {
    merged.free();
  }
}

/**
 * Rebase this store's document onto a fresh peer after the server refused
 * peers another user owns. The fresh peer comes from a new random salt the
 * record keeps, so a reload writes on it too. The work waits behind every
 * queued local write and holds the write queue until the install lands, so
 * no edit runs between reading the document and replacing it. A rebase that
 * cut something, or that lost a race, asks for the pass that sends the
 * current queue.
 */
async function rebaseDocumentStoreOntoFreshPeer(
  context: PeerRebaseContext,
  peerFrontiers: readonly DocumentPeerFrontier[],
): Promise<DocumentPeerRebaseOutcome> {
  const { state } = context;
  const peerSalt = crypto.randomUUID();
  const newPeer = await storedDocumentPeer(state, peerSalt);
  const installation = state.writeChain
    .catch(() => undefined)
    .then(() =>
      chainIdentityWrite(state, () =>
        rebaseOnWriteChain(context, peerFrontiers, peerSalt, newPeer),
      ),
    );
  void chainQueuedWrite(
    state,
    installation.then(
      () => undefined,
      () => undefined,
    ),
  );
  const outcome = await installation;
  if (outcome !== "nothing_to_cut") requestDocumentStoreSync(state);
  return outcome;
}

/** The pass's rebase hook, or none when the adapter cannot install one. */
export function documentStorePeerRebaser(
  context: Omit<PeerRebaseContext, "install">,
): DocumentPeerRebaser | undefined {
  const install = context.state.persistence.installPeerRebase;
  if (!install) return undefined;
  return (peerFrontiers) =>
    rebaseDocumentStoreOntoFreshPeer({ ...context, install }, peerFrontiers);
}
