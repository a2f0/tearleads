import {
  type DocumentPeerFrontier,
  MAX_DOCUMENT_PEER_FRONTIERS,
} from "./response/documentSyncError";

/** A peer's committed frontier (exclusive) and owner; null when unowned. */
export interface CommittedDocumentPeer {
  readonly committedEndCounter: number;
  readonly ownerUserId: string | null;
}

/** One op an update depends on: its peer, and one past its counter. */
export interface DocumentPeerDependency {
  readonly endCounter: number;
  readonly peerId: string;
}

/** One span an update writes: its peer, and one past its last counter. */
export interface DocumentPeerSpan {
  readonly endCounter: number;
  readonly peerId: string;
}

/** What one update of a request names: its dependencies, then its spans. */
export interface DocumentUpdatePeers {
  readonly dependencies: readonly DocumentPeerDependency[];
  readonly spans: readonly DocumentPeerSpan[];
}

/** Why a request is refused, with the peers to name and their frontiers. */
export type DocumentPeerRefusal =
  | {
      readonly kind: "peer_owned";
      readonly peerFrontiers: readonly DocumentPeerFrontier[];
    }
  | {
      readonly kind: "dependency_uncommitted";
      readonly peerFrontiers: readonly DocumentPeerFrontier[];
    };

/** An accepted request names the unowned peers it claims for its writer. */
export type DocumentPeerVerdict =
  | { readonly kind: "accepted"; readonly claimedPeerIds: readonly string[] }
  | DocumentPeerRefusal;

/**
 * Code-unit order, the same as `compareCanonicalStrings` in
 * `@tearleads/crypto`, which this leaf package cannot import.
 */
function comparePeerIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function namedFrontiers(
  peerIds: ReadonlySet<string>,
  committedPeers: ReadonlyMap<string, CommittedDocumentPeer>,
): DocumentPeerFrontier[] {
  return [...peerIds]
    .sort(comparePeerIds)
    .slice(0, MAX_DOCUMENT_PEER_FRONTIERS)
    .map((peerId) => ({
      peerId,
      committedEndCounter: committedPeers.get(peerId)?.committedEndCounter ?? 0,
    }));
}

/** The walk's state: each peer's reached frontier and owner, and its findings. */
interface DocumentPeerWalk {
  readonly claimed: Set<string>;
  readonly frontiers: Map<string, number>;
  readonly owned: Set<string>;
  readonly owners: Map<string, string>;
  readonly uncommitted: Set<string>;
}

function startDocumentPeerWalk(
  committedPeers: ReadonlyMap<string, CommittedDocumentPeer>,
): DocumentPeerWalk {
  const walk: DocumentPeerWalk = {
    claimed: new Set(),
    frontiers: new Map(),
    owned: new Set(),
    owners: new Map(),
    uncommitted: new Set(),
  };
  for (const [peerId, peer] of committedPeers) {
    walk.frontiers.set(peerId, peer.committedEndCounter);
    if (peer.ownerUserId !== null) walk.owners.set(peerId, peer.ownerUserId);
  }
  return walk;
}

/** Every dependency must lie within the frontier the walk has reached. */
function walkDependencies(
  walk: DocumentPeerWalk,
  dependencies: readonly DocumentPeerDependency[],
): void {
  for (const { endCounter, peerId } of dependencies) {
    if (endCounter > (walk.frontiers.get(peerId) ?? 0)) {
      walk.uncommitted.add(peerId);
    }
  }
}

function walkSpans(
  walk: DocumentPeerWalk,
  spans: readonly DocumentPeerSpan[],
  userId: string,
): void {
  for (const span of spans) {
    if (span.endCounter <= (walk.frontiers.get(span.peerId) ?? 0)) continue;
    walk.frontiers.set(span.peerId, span.endCounter);
    const owner = walk.owners.get(span.peerId);
    if (owner === undefined) {
      walk.owners.set(span.peerId, userId);
      walk.claimed.add(span.peerId);
    } else if (owner !== userId) {
      walk.owned.add(span.peerId);
    }
  }
}

/**
 * The server's rule for the peers a document write names, kept here so the
 * API and the client SDK's recovery tests judge with one implementation. It
 * takes decoded counters, not version vectors.
 *
 * Walks the updates in request order. Each update's dependencies must lie
 * within the frontier the walk has reached: committed, or written by an
 * earlier update of the request. Then each of its spans: one ending at or
 * below the frontier re-asserts committed counters, which any writer may do;
 * one ending past it claims an unowned peer, extends the writer's own, or is
 * refused when another user owns the peer. The frontier rises as the walk
 * goes, so a request may chain updates on one peer. Refused peers report the
 * frontier committed before the request, which rolls back; a peer another
 * user owns outranks an uncommitted dependency.
 */
export function judgeDocumentPeerSpans(input: {
  readonly committedPeers: ReadonlyMap<string, CommittedDocumentPeer>;
  readonly updates: readonly DocumentUpdatePeers[];
  readonly userId: string;
}): DocumentPeerVerdict {
  const walk = startDocumentPeerWalk(input.committedPeers);
  for (const update of input.updates) {
    walkDependencies(walk, update.dependencies);
    walkSpans(walk, update.spans, input.userId);
  }
  if (walk.owned.size > 0) {
    return {
      kind: "peer_owned",
      peerFrontiers: namedFrontiers(walk.owned, input.committedPeers),
    };
  }
  if (walk.uncommitted.size > 0) {
    return {
      kind: "dependency_uncommitted",
      peerFrontiers: namedFrontiers(walk.uncommitted, input.committedPeers),
    };
  }
  return {
    kind: "accepted",
    claimedPeerIds: [...walk.claimed].sort(comparePeerIds),
  };
}
