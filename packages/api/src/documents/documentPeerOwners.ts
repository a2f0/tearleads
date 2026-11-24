import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentPeerOwners,
  documentUpdateSpans,
} from "@tearleads/api-shared/schema";
import { compareCanonicalStrings } from "@tearleads/crypto";
import {
  decodeVersionVector,
  listVersionVectorSpans,
  type VersionVectorSpan,
} from "@tearleads/loro";
import {
  type DocumentPeerFrontier,
  MAX_DOCUMENT_PEER_FRONTIERS,
} from "@tearleads/validators/response";
import { and, eq, inArray, max, sql } from "drizzle-orm";

interface DocumentUpdatePeerSource {
  readonly dependencyVersionVector: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
}

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

/** What one update of a request names: its dependencies, then its spans. */
export interface DocumentUpdatePeers {
  readonly dependencies: readonly DocumentPeerDependency[];
  readonly spans: readonly VersionVectorSpan[];
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

function namedFrontiers(
  peerIds: ReadonlySet<string>,
  committedPeers: ReadonlyMap<string, CommittedDocumentPeer>,
): DocumentPeerFrontier[] {
  return [...peerIds]
    .sort(compareCanonicalStrings)
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
  spans: readonly VersionVectorSpan[],
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
    claimedPeerIds: [...walk.claimed].sort(compareCanonicalStrings),
  };
}

/** The ops an update's signed dependency vector names, zero counters aside. */
function listDocumentPeerDependencies(
  dependencyVersionVector: string,
): DocumentPeerDependency[] {
  return [...decodeVersionVector(dependencyVersionVector).toJSON()]
    .filter(([, endCounter]) => endCounter > 0)
    .map(([peerId, endCounter]) => ({ endCounter, peerId }));
}

/**
 * One statement: each named peer's committed frontier from its spans and its
 * owner, as separate rows so a peer with spans but no owner row (or the
 * reverse) still reads correctly. Never depend on UNION order.
 */
async function readCommittedDocumentPeers(
  executor: DatabaseSession,
  documentId: string,
  peerIds: readonly string[],
): Promise<Map<string, CommittedDocumentPeer>> {
  const rows = await executor
    .select({
      peerId: documentUpdateSpans.peerId,
      committedEndCounter: max(documentUpdateSpans.endCounter),
      ownerUserId: sql<string | null>`null`,
    })
    .from(documentUpdateSpans)
    .where(
      and(
        eq(documentUpdateSpans.documentId, documentId),
        inArray(documentUpdateSpans.peerId, [...peerIds]),
      ),
    )
    .groupBy(documentUpdateSpans.peerId)
    .unionAll(
      executor
        .select({
          peerId: documentPeerOwners.peerId,
          committedEndCounter: sql<number | null>`null`,
          ownerUserId: sql<string | null>`${documentPeerOwners.ownerUserId}`,
        })
        .from(documentPeerOwners)
        .where(
          and(
            eq(documentPeerOwners.documentId, documentId),
            inArray(documentPeerOwners.peerId, [...peerIds]),
          ),
        ),
    );
  const peers = new Map<string, CommittedDocumentPeer>();
  for (const row of rows) {
    const known = peers.get(row.peerId);
    peers.set(row.peerId, {
      committedEndCounter:
        row.committedEndCounter ?? known?.committedEndCounter ?? 0,
      ownerUserId: row.ownerUserId ?? known?.ownerUserId ?? null,
    });
  }
  return peers;
}

/**
 * Claims every unowned peer a write extends for its writer, unless the write
 * extends a peer another user owns or depends on an op nobody committed: then
 * it claims nothing and returns the refusal, and the caller refuses the whole
 * request. Pass only the request's newly verified updates, in request order.
 * The caller holds the document head lock from this read through the insert
 * of the updates' spans, so no other write moves a frontier or an owner in
 * between. A document this transaction inserted has nothing committed: every
 * delete of a document row deletes its spans and owners, so a create's seed
 * skips the read, may depend on nothing, and claims every peer it carries.
 */
export async function claimDocumentPeers(
  executor: DatabaseSession,
  input: {
    readonly documentId: string;
    readonly documentInsertedInTransaction: boolean;
    readonly updates: readonly DocumentUpdatePeerSource[];
    readonly userId: string;
  },
): Promise<DocumentPeerRefusal | null> {
  const updates = input.updates.map((update) => ({
    dependencies: listDocumentPeerDependencies(update.dependencyVersionVector),
    spans: listVersionVectorSpans({
      partialEndVersionVector: update.partialEndVersionVector,
      partialStartVersionVector: update.partialStartVersionVector,
    }),
  }));
  const peerIds = [
    ...new Set(
      updates.flatMap((update) => [
        ...update.dependencies.map((dependency) => dependency.peerId),
        ...update.spans.map((span) => span.peerId),
      ]),
    ),
  ].sort(compareCanonicalStrings);
  if (peerIds.length === 0) return null;

  const verdict = judgeDocumentPeerSpans({
    committedPeers: input.documentInsertedInTransaction
      ? new Map()
      : await readCommittedDocumentPeers(executor, input.documentId, peerIds),
    updates,
    userId: input.userId,
  });
  if (verdict.kind !== "accepted") return verdict;
  if (verdict.claimedPeerIds.length === 0) return null;

  // No conflict clause: under the lock no other writer can have claimed one of
  // these peers since the read (nor before a create's seed), and if one did,
  // the primary key fails the request instead of letting its spans extend
  // that writer's peer.
  await executor.insert(documentPeerOwners).values(
    verdict.claimedPeerIds.map((peerId) => ({
      documentId: input.documentId,
      ownerUserId: input.userId,
      peerId,
    })),
  );
  return null;
}
