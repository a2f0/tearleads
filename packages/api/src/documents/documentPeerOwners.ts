import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentPeerOwners,
  documentUpdateSpans,
} from "@tearleads/api-shared/schema";
import { compareCanonicalStrings } from "@tearleads/crypto";
import { decodeVersionVector, listVersionVectorSpans } from "@tearleads/loro";
import {
  type CommittedDocumentPeer,
  type DocumentPeerDependency,
  type DocumentPeerRefusal,
  judgeDocumentPeerSpans,
} from "@tearleads/validators/documentPeerSpans";
import { and, type Column, eq, max, type SQL, sql } from "drizzle-orm";
import { chunkDocumentPeerRows } from "./documentPeerRowChunks";

interface DocumentUpdatePeerSource {
  readonly dependencyVersionVector: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
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
 * `column` is one of `peerIdsJson`, bound as one parameter: a request names
 * as many peers as its byte ceiling admits, and Postgres binds at most 65,535
 * parameters to a statement.
 */
function isNamedPeer(column: Column, peerIdsJson: string): SQL {
  return sql`${column} in (select jsonb_array_elements_text(${peerIdsJson}::jsonb))`;
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
  const peerIdsJson = JSON.stringify(peerIds);
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
        isNamedPeer(documentUpdateSpans.peerId, peerIdsJson),
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
            isNamedPeer(documentPeerOwners.peerId, peerIdsJson),
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
  // that writer's peer. A write may claim more peers than one statement can
  // bind, so the rows go in chunks within the caller's transaction.
  const ownerRows = verdict.claimedPeerIds.map((peerId) => ({
    documentId: input.documentId,
    ownerUserId: input.userId,
    peerId,
  }));
  for (const chunk of chunkDocumentPeerRows(ownerRows)) {
    await executor.insert(documentPeerOwners).values(chunk);
  }
  return null;
}
