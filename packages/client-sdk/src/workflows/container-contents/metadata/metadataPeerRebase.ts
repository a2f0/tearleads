import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  getImportBlobMetadata,
  importUpdates,
  versionVectorsEqual,
} from "@tearleads/loro";
import type { DocumentPeerFrontier } from "@tearleads/validators/response";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import {
  asPeerId,
  rebaseOntoFreshPeer,
  unsentStartOf,
} from "../../../data/documents/shared/sync/peerRebase";
import type { ContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type {
  DocumentPeerRebaseOutcome,
  DocumentPeerRebaser,
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
 * install, which replaces both, keeps whatever another runtime wrote.
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

async function rebaseLiveMetadata(
  context: MetadataPeerRebaseContext,
  peerFrontiers: readonly DocumentPeerFrontier[],
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
    const rebase = rebaseOntoFreshPeer({
      live: merged,
      newPeer: freshPeer(),
      refusedFrontiers: new Map(
        peerFrontiers.map((frontier) => [
          frontier.peerId,
          frontier.committedEndCounter,
        ]),
      ),
      // Every local metadata write queues its own update beside the content,
      // so the queue alone marks what this device has not sent.
      unsentStart: unsentStartOf({
        liveVersion: encodeVersionVector(merged),
        pendingBases: [],
        queued,
      }),
    });
    if (rebase.kind === "nothing_to_cut") return "nothing_to_cut";
    const { fork } = rebase;
    const metadataUpdates = exportAllUpdates(fork);
    const pendingUpdate = createPendingUpdateFields(rebase.update);
    if (!pendingUpdate) {
      fork.free();
      throw new Error("Peer rebase produced no metadata update to send");
    }
    const endVersionVector =
      getImportBlobMetadata(metadataUpdates).partialEndVersionVector;
    const installed = await context.install(context.execSql, {
      checkpoint: {
        endVersionVector,
        snapshot: bytesToBase64(metadataUpdates),
      },
      expectedDocumentId: documentId,
      expectedRecoveryGeneration: record.recoveryGeneration ?? 0,
      pendingUpdate,
      readVersion: encodeVersionVector(merged),
      record: { kind: "container_metadata" },
      scope: containerMetadataScope(metadataState.container.id),
      stillCurrent,
    });
    if (!installed || !stillCurrent()) {
      fork.free();
      return "superseded";
    }
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
    merged.free();
  }
}

/**
 * The metadata pass's rebase hook, or none when the adapter cannot install
 * one. A rebase that cut something, or that lost a race, asks the host for
 * the pass that sends the current queue.
 */
export function containerMetadataPeerRebaser(
  context: Omit<MetadataPeerRebaseContext, "install">,
): DocumentPeerRebaser | undefined {
  const install = context.persistence.installPeerRebase;
  if (!install) return undefined;
  return async (peerFrontiers) => {
    const outcome = await rebaseLiveMetadata(
      { ...context, install },
      peerFrontiers,
    );
    if (outcome !== "nothing_to_cut") context.onRebased();
    return outcome;
  };
}
