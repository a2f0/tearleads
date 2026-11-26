import {
  type createDocument,
  encodeVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentPeerFrontier,
  isDocumentPeerRebaseErrorCode,
} from "@tearleads/validators/response";
import {
  countersOf,
  type PeerCounters,
  rebaseOntoFreshPeer,
  unsentStartOf,
  versionOf,
} from "./peerRebase";

type RecoveryDocument = Awaited<ReturnType<typeof createDocument>>;

/**
 * The rule a sync was refused under: `document_sync_peer_owned` (it extends
 * a peer another user owns) or `document_sync_dependency_uncommitted` (it
 * depends on an operation nobody committed).
 */
export type PeerRefusalKind = "dependency_uncommitted" | "peer_owned";

/** A refusal with the committed frontier of each peer the server named. */
export interface PeerRefusal {
  readonly kind: PeerRefusalKind;
  readonly peerFrontiers: readonly DocumentPeerFrontier[];
}

/**
 * The peer refusal a failed sync carries, or null when the failure is
 * another kind or names no peer, which leaves nothing to recover from.
 */
export function peerRefusalOf(failure: {
  readonly code?: string | undefined;
  readonly peerFrontiers?: readonly DocumentPeerFrontier[] | undefined;
}): PeerRefusal | null {
  const peerFrontiers = failure.peerFrontiers ?? [];
  if (
    !isDocumentPeerRebaseErrorCode(failure.code) ||
    peerFrontiers.length === 0
  ) {
    return null;
  }
  return {
    kind:
      failure.code === DOCUMENT_SYNC_ERROR_CODES.peerOwned
        ? "peer_owned"
        : "dependency_uncommitted",
    peerFrontiers,
  };
}

export interface PeerRefusalRecoveryInput {
  /**
   * The record's committed version: what sync settlements showed the server
   * to hold. Absent when the record has settled none.
   */
  readonly committedVersion: string | null | undefined;
  /** The live document with every durable row merged in. */
  readonly live: RecoveryDocument;
  /** The fresh peer a rebase writes the cut operations on. */
  readonly newPeer: `${number}`;
  /** The record's pending bases; see `unsentStartOf`. */
  readonly pendingBases: readonly (string | null | undefined)[];
  readonly queued: readonly {
    readonly partialEndVersionVector: string;
    readonly partialStartVersionVector: string;
  }[];
  readonly refusal: PeerRefusal;
}

/**
 * What a device does about a peer refusal.
 *
 * - `rebase`: the refused operations are its own unsent ones. It installs
 *   `fork`, which writes them again on a fresh peer, and queues `update`.
 * - `relay`: the server lost operations the device saw committed, and the
 *   refusal was for a dependency on them. The document stays as it is; the
 *   queue becomes `update`, which sends the lost operations again under
 *   their own peers from the frontier the server named.
 * - `park`: the server lost such operations on a peer another user now
 *   owns, so the device may not send them, and writing them again on a
 *   fresh peer would duplicate them for every device that still holds them.
 *   The queue and the document stay as they are, and a later pass recovers
 *   once that user's device has sent them.
 * - `nothing_to_relay`: the server lost such operations and refused a
 *   dependency on them, but the queue already starts at or below every
 *   frontier that fell, so a relay would queue the same operations again.
 *   The refused request was not this queue: another runtime relayed after
 *   it was built, or it carried only part of the queue. Nothing changes and
 *   no other user is waited on; the server's refusal stands for the pass.
 * - `nothing_to_cut`: no refused peer passes its frontier.
 *
 * `committedVersion` is what the device knew was committed when it planned
 * the recovery. The install raises the record's committed version to it:
 * the one update it queues may start below operations that until now were
 * known committed only for being outside the queue.
 */
export type PeerRefusalRecovery =
  | { readonly kind: "nothing_to_cut" }
  | { readonly kind: "nothing_to_relay" }
  | { readonly kind: "park" }
  | {
      readonly kind: "rebase";
      readonly committedVersion: string;
      readonly fork: RecoveryDocument;
      readonly update: Uint8Array;
    }
  | {
      readonly kind: "relay";
      readonly committedVersion: string;
      readonly update: Uint8Array;
    };

function encoded(peerCounters: PeerCounters): string {
  return encodeVersionVectorCounters(Object.fromEntries(peerCounters));
}

/** The queue's start, lowered to each regressed frontier below it. */
function relayStart(
  unsentStart: PeerCounters,
  regressedFrontiers: PeerCounters,
): Map<string, number> | null {
  const start = new Map(unsentStart);
  let lowered = false;
  for (const [peer, frontier] of regressedFrontiers) {
    if (frontier >= (start.get(peer) ?? 0)) continue;
    start.set(peer, frontier);
    lowered = true;
  }
  return lowered ? start : null;
}

/**
 * Decide how a device recovers from a peer refusal: rebase its own unsent
 * operations onto a fresh peer, or, when the server's history went
 * backwards, relay what the server lost or park until another device does.
 */
export function planPeerRefusalRecovery(
  input: PeerRefusalRecoveryInput,
): PeerRefusalRecovery {
  const { live, refusal } = input;
  live.commit();
  const unsentStart = unsentStartOf({
    liveVersion: encodeVersionVector(live),
    pendingBases: input.pendingBases,
    queued: input.queued,
  });
  const rebase = rebaseOntoFreshPeer({
    committedVersion: countersOf(input.committedVersion),
    live,
    newPeer: input.newPeer,
    refusedFrontiers: new Map(
      refusal.peerFrontiers.map((frontier) => [
        frontier.peerId,
        frontier.committedEndCounter,
      ]),
    ),
    unsentStart,
  });
  switch (rebase.kind) {
    case "nothing_to_cut":
      return rebase;
    case "rebased":
      return {
        committedVersion: encoded(rebase.knownCommitted),
        fork: rebase.fork,
        kind: "rebase",
        update: rebase.update,
      };
    case "history_regressed": {
      if (refusal.kind === "peer_owned") return { kind: "park" };
      const start = relayStart(unsentStart, rebase.regressedFrontiers);
      if (!start) return { kind: "nothing_to_relay" };
      return {
        committedVersion: encoded(rebase.knownCommitted),
        kind: "relay",
        update: live.export({ from: versionOf(start), mode: "update" }),
      };
    }
  }
}
