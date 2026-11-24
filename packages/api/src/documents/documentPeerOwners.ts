import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentPeerOwners,
  documentUpdateSpans,
} from "@tearleads/api-shared/schema";
import { compareCanonicalStrings } from "@tearleads/crypto";
import {
  listVersionVectorSpans,
  type VersionVectorSpan,
} from "@tearleads/loro";
import {
  type DocumentPeerFrontier,
  MAX_DOCUMENT_PEER_FRONTIERS,
} from "@tearleads/validators/response";
import { and, eq, inArray, max, sql } from "drizzle-orm";

interface DocumentUpdateSpanSource {
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
}

/** A peer's committed frontier (exclusive) and owner; null when unowned. */
export interface CommittedDocumentPeer {
  readonly committedEndCounter: number;
  readonly ownerUserId: string | null;
}

export interface DocumentPeerVerdict {
  /** Unowned peers the request extends, claimed for its writer. */
  readonly claimedPeerIds: readonly string[];
  /** Other users' peers the request extends, canonical order, bounded. */
  readonly refused: readonly DocumentPeerFrontier[];
}

/**
 * Walks the spans in request order. A span ending at or below the frontier
 * re-asserts committed counters, which any writer may do. One ending past it
 * claims an unowned peer, extends the writer's own, or is refused when
 * another user owns the peer. The frontier rises as the walk goes, so a
 * request may chain updates on one peer; refused peers report the frontier
 * committed before the request, which rolls back.
 */
export function judgeDocumentPeerSpans(input: {
  readonly committedPeers: ReadonlyMap<string, CommittedDocumentPeer>;
  readonly spans: readonly VersionVectorSpan[];
  readonly userId: string;
}): DocumentPeerVerdict {
  const frontiers = new Map<string, number>();
  const owners = new Map<string, string>();
  for (const [peerId, peer] of input.committedPeers) {
    frontiers.set(peerId, peer.committedEndCounter);
    if (peer.ownerUserId !== null) owners.set(peerId, peer.ownerUserId);
  }
  const claimed = new Set<string>();
  const refused = new Set<string>();
  for (const span of input.spans) {
    if (span.endCounter <= (frontiers.get(span.peerId) ?? 0)) continue;
    frontiers.set(span.peerId, span.endCounter);
    const owner = owners.get(span.peerId);
    if (owner === undefined) {
      owners.set(span.peerId, input.userId);
      claimed.add(span.peerId);
    } else if (owner !== input.userId) {
      refused.add(span.peerId);
    }
  }
  return {
    claimedPeerIds: [...claimed].sort(compareCanonicalStrings),
    refused: [...refused]
      .sort(compareCanonicalStrings)
      .slice(0, MAX_DOCUMENT_PEER_FRONTIERS)
      .map((peerId) => ({
        peerId,
        committedEndCounter:
          input.committedPeers.get(peerId)?.committedEndCounter ?? 0,
      })),
  };
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
 * extends a peer another user owns: then it claims nothing and returns those
 * peers with their committed frontiers, and the caller refuses the whole
 * request. Pass only the request's newly verified updates, in request order.
 * The caller holds the document head lock from this read through the insert
 * of the updates' spans, so no other write moves a frontier or an owner in
 * between. A document this transaction inserted has nothing
 * committed: every delete of a document row deletes its spans and owners, so
 * a create's seed skips the read and claims every peer it carries.
 */
export async function claimDocumentPeers(
  executor: DatabaseSession,
  input: {
    readonly documentId: string;
    readonly documentInsertedInTransaction: boolean;
    readonly updates: readonly DocumentUpdateSpanSource[];
    readonly userId: string;
  },
): Promise<readonly DocumentPeerFrontier[]> {
  const spans = input.updates.flatMap((update) =>
    listVersionVectorSpans({
      partialEndVersionVector: update.partialEndVersionVector,
      partialStartVersionVector: update.partialStartVersionVector,
    }),
  );
  if (spans.length === 0) return [];

  const peerIds = [...new Set(spans.map((span) => span.peerId))].sort(
    compareCanonicalStrings,
  );
  const verdict = judgeDocumentPeerSpans({
    committedPeers: input.documentInsertedInTransaction
      ? new Map()
      : await readCommittedDocumentPeers(executor, input.documentId, peerIds),
    spans,
    userId: input.userId,
  });
  if (verdict.refused.length > 0) return verdict.refused;
  if (verdict.claimedPeerIds.length === 0) return [];

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
  return [];
}
