import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  getImportBlobMetadata,
  importUpdates,
  versionVectorsEqual,
} from "@tearleads/loro";
import { asPeerId } from "../../../data/documents/shared/sync/peerRebase";
import {
  type PeerRefusal,
  type PeerRefusalRecovery,
  planPeerRefusalRecovery,
} from "../../../data/documents/shared/sync/peerRefusalRecovery";
import type { ContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type DocumentPeerRebaseOutcome,
  type DocumentPeerRebaser,
  peerRebaseChangedQueue,
  queuedRecoveryUpdate,
} from "../../documents";
import { containerMetadataScope } from "./metadataSyncVerdicts";
import type { ContainerMetadataState } from "./metadataTypes";

type InstallPeerRebase = NonNullable<
  ContainerContentsPersistence["installPeerRebase"]
>;

interface MetadataPeerRebaseContext {
  readonly execSql: ExecSql;
  readonly install: InstallPeerRebase;
  readonly isCurrent: () => boolean;
  /** The live state, never the pass's detached copy. */
  readonly metadataState: ContainerMetadataState;
  readonly onRebased: () => void;
  readonly persistence: ContainerContentsPersistence;
}

/** A random peer no record derives. */
function freshPeer(): `${number}` {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2));
  const peer = (BigInt(high) << 32n) | BigInt(low) || 1n;
  return asPeerId(peer.toString());
}

/**
 * The live metadata with its stored content and queue merged in, so the
 * install, which replaces the queue, keeps whatever another runtime wrote.
 */
async function readMergedMetadata(context: MetadataPeerRebaseContext) {
  const { execSql, metadataState, persistence } = context;
  const containerId = metadataState.container.id;
  const [stored, queued] = await Promise.all([
    persistence.loadContainerMetadataState(execSql, containerId),
    persistence.listPendingUpdates(execSql, containerId),
  ]);
  const merged = metadataState.doc.fork();
  try {
    const updates = [
      ...(stored?.record?.metadataUpdates
        ? [base64ToBytes(stored.record.metadataUpdates)]
        : []),
      ...queued.map((row) => base64ToBytes(row.updateData)),
    ];
    if (updates.length > 0) importUpdates(merged, updates);
  } catch (error) {
    merged.free();
    throw error;
  }
  return { merged, queued, record: stored?.record ?? null };
}

/** What every install of this recovery must still find. */
type MetadataInstallFence = Pick<
  Parameters<InstallPeerRebase>[1],
  | "expectedDocumentId"
  | "expectedRecoveryGeneration"
  | "queuedUpdateIds"
  | "readVersion"
  | "scope"
  | "stillCurrent"
>;

async function installMetadataFork(
  context: MetadataPeerRebaseContext,
  fence: MetadataInstallFence,
  rebase: Extract<PeerRefusalRecovery, { kind: "rebase" }>,
): Promise<DocumentPeerRebaseOutcome> {
  const { metadataState } = context;
  const { fork } = rebase;
  let installed = false;
  try {
    const metadataUpdates = exportAllUpdates(fork);
    const endVersionVector =
      getImportBlobMetadata(metadataUpdates).partialEndVersionVector;
    installed =
      (await context.install(context.execSql, {
        ...fence,
        checkpoint: {
          endVersionVector,
          snapshot: bytesToBase64(metadataUpdates),
        },
        kind: "fork",
        ...queuedRecoveryUpdate(rebase),
        record: { kind: "container_metadata" },
      })) && fence.stillCurrent();
    if (!installed) return "superseded";
    // The fork's fresh peer is memory-only and is not bound to the runtime's
    // writer peers: no other document may borrow it. A reload derives the
    // writer's own peer again, which the server still refuses, so its next
    // write rebases again; once per written container and session.
    // An edit whose copy predates this install fails its commit's content
    // check and merges the fork. The fork's operations are stamped from the
    // cut, so they rank below that edit unless the cut holds a later remote
    // write.
    metadataState.doc = fork;
    metadataState.record = {
      ...metadataState.record,
      metadataUpdates: bytesToBase64(metadataUpdates),
      snapshotEndVersion: endVersionVector,
    };
    return "rebased";
  } finally {
    if (!installed) fork.free();
  }
}

async function recoverLiveMetadata(
  context: MetadataPeerRebaseContext,
  refusal: PeerRefusal,
): Promise<DocumentPeerRebaseOutcome> {
  const { metadataState } = context;
  const live = metadataState.doc;
  const liveVersion = encodeVersionVector(live);
  const stillCurrent = () =>
    context.isCurrent() &&
    metadataState.doc === live &&
    versionVectorsEqual(encodeVersionVector(live), liveVersion);
  const { merged, queued, record } = await readMergedMetadata(context);
  try {
    const documentId = metadataState.record.documentId;
    if (!stillCurrent() || !documentId || record?.documentId !== documentId) {
      return "superseded";
    }
    const recovery = planPeerRefusalRecovery({
      // The stored content holds this device's unsent writes too, so it
      // does not say what is committed. The stored record's version does
      // for whatever the queue sends again.
      committedVersion: record.committedVersion,
      live: merged,
      newPeer: freshPeer(),
      // Every local metadata write queues its own update beside the content,
      // so the queue marks where this device's unsent writes start.
      pendingBases: [],
      queued,
      refusal,
    });
    if (
      recovery.kind === "nothing_to_cut" ||
      recovery.kind === "nothing_to_relay"
    ) {
      return recovery.kind;
    }
    if (recovery.kind === "park") return "parked";
    const fence = {
      expectedDocumentId: documentId,
      expectedRecoveryGeneration: record.recoveryGeneration ?? 0,
      queuedUpdateIds: queued.map((row) => row.id),
      readVersion: encodeVersionVector(merged),
      scope: containerMetadataScope(metadataState.container.id),
      stillCurrent,
    };
    if (recovery.kind === "rebase") {
      return await installMetadataFork(context, fence, recovery);
    }
    // A relay sends operations the stored content already holds, so the
    // content, the live document, and its writer peer stay as they are.
    const installed = await context.install(context.execSql, {
      ...fence,
      kind: "relay",
      ...queuedRecoveryUpdate(recovery),
    });
    return installed && stillCurrent() ? "relayed" : "superseded";
  } finally {
    merged.free();
  }
}

/**
 * The metadata pass's recovery hook, or none when the adapter cannot install
 * one. It rebases onto a fresh peer, or, when the server's history went
 * backwards, relays the operations the server lost or parks until the
 * owner's device restores them. A recovery that changed the queue, or that
 * lost a race, asks the host for the pass that sends the current queue.
 */
export function containerMetadataPeerRebaser(
  context: Omit<MetadataPeerRebaseContext, "install">,
): DocumentPeerRebaser | undefined {
  const install = context.persistence.installPeerRebase;
  if (!install) return undefined;
  return async (refusal) => {
    const outcome = await recoverLiveMetadata({ ...context, install }, refusal);
    if (peerRebaseChangedQueue(outcome)) context.onRebased();
    return outcome;
  };
}
