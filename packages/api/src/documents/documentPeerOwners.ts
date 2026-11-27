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
  type DocumentPeerSpan,
  judgeDocumentPeerSpans,
} from "@tearleads/validators/documentPeerSpans";
import { and, type Column, eq, max, type SQL, sql } from "drizzle-orm";
import { readStagedBaselineFrontier } from "./documentBaselineStageStore";
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
 * Whether a write of `spans` by `userId` would extend, past its committed
 * frontier, a peer another user owns: the ownership refusal of
 * `judgeDocumentPeerSpans`, by that rule itself. It reads only the named
 * peers. A caller that does not hold the document head lock learns what
 * held when it asked, not what will hold at its commit.
 */
export async function extendsPeerOwnedByOthers(
  executor: DatabaseSession,
  input: {
    readonly documentId: string;
    readonly spans: readonly DocumentPeerSpan[];
    readonly userId: string;
  },
): Promise<boolean> {
  if (input.spans.length === 0) return false;
  const verdict = judgeDocumentPeerSpans({
    committedPeers: await readCommittedDocumentPeers(
      executor,
      input.documentId,
      [...new Set(input.spans.map((span) => span.peerId))],
    ),
    updates: [{ dependencies: [], spans: input.spans }],
    userId: input.userId,
  });
  return verdict.kind === "peer_owned";
}

/**
 * The committed peers as they will stand once the staged baseline the
 * request commits is promoted: each peer the stage extends ends where the
 * stage leaves it and is its writer's. The caller has refused a stage that
 * extends another user's peer, so an extended peer is the writer's already
 * or nobody's. The request's own updates are judged against this before
 * the stage is promoted, so a request that will be refused is refused
 * without the promotion's writes.
 */
async function overlayStagedBaseline(
  executor: DatabaseSession,
  committedPeers: Map<string, CommittedDocumentPeer>,
  input: {
    readonly baselineId: string;
    readonly documentId: string;
    readonly peerIds: readonly string[];
    readonly userId: string;
  },
): Promise<void> {
  const staged = await readStagedBaselineFrontier(
    executor,
    input,
    input.peerIds,
  );
  for (const [peerId, endCounter] of staged) {
    const peer = committedPeers.get(peerId);
    if (endCounter <= (peer?.committedEndCounter ?? 0)) continue;
    committedPeers.set(peerId, {
      committedEndCounter: endCounter,
      ownerUserId: peer?.ownerUserId ?? input.userId,
    });
  }
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
    /** The stage the request commits, not yet promoted, if it commits one. */
    readonly stagedBaselineId?: string | undefined;
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

  const committedPeers = input.documentInsertedInTransaction
    ? new Map<string, CommittedDocumentPeer>()
    : await readCommittedDocumentPeers(executor, input.documentId, peerIds);
  if (input.stagedBaselineId !== undefined) {
    await overlayStagedBaseline(executor, committedPeers, {
      baselineId: input.stagedBaselineId,
      documentId: input.documentId,
      peerIds,
      userId: input.userId,
    });
  }
  const verdict = judgeDocumentPeerSpans({
    committedPeers,
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
