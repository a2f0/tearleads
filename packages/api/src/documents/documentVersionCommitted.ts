import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documentUpdateSpans } from "@tearleads/api-shared/schema";
import { and, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import type { DocumentVersionFrontier } from "./documentUpdateStore";

const frontierRowsSchema = z.array(
  z.object({ counter: z.number().int().nonnegative(), peer_id: z.string() }),
);

/**
 * Whether `version` names an op no committed update of the document
 * declares: a counter past the end of every span committed on that peer.
 * `version` is a frontier `parseDocumentVersionFrontier` encoded, such as a
 * bind version stored with its binding. The committed frontier counts every
 * declared span, including one every reader voided, so an op it holds has
 * reached the server even when no client version holds it.
 */
export async function hasUncommittedVersionOps(
  executor: DatabaseSession,
  input: {
    readonly documentId: string;
    readonly version: DocumentVersionFrontier;
  },
): Promise<boolean> {
  const counters = frontierRowsSchema
    .parse(JSON.parse(input.version.frontierJson))
    .filter((row) => row.counter > 0);
  if (counters.length === 0) {
    return false;
  }
  const committed = await executor
    .select({
      endCounter: max(documentUpdateSpans.endCounter),
      peerId: documentUpdateSpans.peerId,
    })
    .from(documentUpdateSpans)
    .where(
      and(
        eq(documentUpdateSpans.documentId, input.documentId),
        inArray(
          documentUpdateSpans.peerId,
          counters.map((row) => row.peer_id),
        ),
      ),
    )
    .groupBy(documentUpdateSpans.peerId);
  const committedEnd = new Map(
    committed.map((row) => [row.peerId, row.endCounter ?? 0]),
  );
  return counters.some(
    (row) => (committedEnd.get(row.peer_id) ?? 0) < row.counter,
  );
}
