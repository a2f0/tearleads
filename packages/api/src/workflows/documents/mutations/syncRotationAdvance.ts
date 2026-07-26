import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { mergeVersionVectors, satisfiesVersionVector } from "@tearleads/loro";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { eq, inArray } from "drizzle-orm";
import { getLatestDocumentContentKeyEpoch } from "../../../access/read/documentContentKeyStore";
import { DocumentMutationError } from "./errors";
import { readWriteHeader } from "./shared/records";

/**
 * A sync request that ADVANCES the content-key epoch is a rotation (e.g. the
 * stale-bundle heal after a container KEK rotation). Rotated-away epochs
 * become undecryptable for every reader, so the advance must be anchored by a
 * rotation baseline that dominates the whole committed frontier — otherwise
 * uncovered old-epoch updates are served forever, poison every reader's
 * all-or-nothing decrypt, and the document never converges (mirrors the
 * atomic unlink's assertAtomicRotationBaselineCoversCommittedFrontier).
 *
 * A device that is behind must not heal, and cannot make itself eligible by
 * pulling first: the uncovered updates are encrypted under keys wrapped to
 * the rotated-away container KEK epoch, which no post-rotation projection
 * serves wraps for, so they are undecryptable to every puller. The device
 * holding the full history (typically the author of the uncovered updates)
 * is the one that can heal; rejecting the rest preserves that data instead
 * of silently orphaning it under a non-covering baseline.
 */
export async function assertEpochAdvanceAnchoredByCoveringBaseline(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}): Promise<void> {
  const bundle = input.request.contentKeyBundle;
  if (!bundle) {
    return;
  }
  const latestEpoch = await getLatestDocumentContentKeyEpoch(
    input.documentId,
    input.executor,
  );
  if (latestEpoch === null || bundle.contentKeyEpoch <= latestEpoch) {
    return;
  }

  const committedUpdates = await input.executor
    .select({
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
    })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, input.documentId));
  if (committedUpdates.length === 0) {
    return;
  }

  const baselines = input.request.outgoingUpdates.filter(
    (update) => update.checkpointKind === "rotate_baseline",
  );
  if (baselines.length === 0) {
    throw new DocumentMutationError(
      "Document content-key rotation requires a rotation baseline covering committed updates",
      409,
    );
  }
  // A replayed, already-committed baseline id would sail through the append
  // path's idempotent-retry equality check with its ORIGINAL (old-epoch)
  // write header, advancing the epoch without storing a baseline readable
  // under the new key. The anchoring baseline must be newly written by this
  // request and authenticated under the advancing epoch.
  const committedBaselineRows = await input.executor
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(
      inArray(
        documentUpdates.id,
        baselines.map((baseline) => baseline.id),
      ),
    );
  if (committedBaselineRows.length > 0) {
    throw new DocumentMutationError(
      "Document content-key rotation baseline must be newly written",
      409,
    );
  }
  const committedFrontier = mergeVersionVectors(
    committedUpdates.map((update) => update.partialEndVersionVector),
  );
  for (const baseline of baselines) {
    const header = readWriteHeader(
      baseline.writeHeader,
      "Document rotation baseline write header",
    );
    if (header.contentKeyEpoch !== bundle.contentKeyEpoch) {
      throw new DocumentMutationError(
        "Document content-key rotation baseline must use the advancing content-key epoch",
        409,
      );
    }
    // The wire schema only requires a non-empty string; an undecodable vector
    // must surface as a client error, not a 500 out of the vector decoder.
    let coversCommittedFrontier: boolean;
    try {
      coversCommittedFrontier =
        !!baseline.sourceVersionVector &&
        satisfiesVersionVector(baseline.sourceVersionVector, committedFrontier);
    } catch {
      throw new DocumentMutationError(
        "Document content-key rotation baseline source vector is invalid",
        400,
      );
    }
    if (!coversCommittedFrontier) {
      throw new DocumentMutationError(
        "Document content-key rotation baseline does not cover the committed frontier",
        409,
      );
    }
  }
}
