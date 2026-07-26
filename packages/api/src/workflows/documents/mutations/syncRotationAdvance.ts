import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { mergeVersionVectors, satisfiesVersionVector } from "@tearleads/loro";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { getLatestDocumentContentKeyEpoch } from "../../../access/read/documentContentKeyStore";
import { DocumentMutationError } from "./errors";

/**
 * A sync request that ADVANCES the content-key epoch is a rotation (e.g. the
 * stale-bundle heal after a container KEK rotation). Rotated-away epochs
 * become undecryptable for every reader, so the advance must be anchored by a
 * rotation baseline that dominates the whole committed frontier — otherwise
 * uncovered old-epoch updates are served forever, poison every reader's
 * all-or-nothing decrypt, and the document never converges (mirrors the
 * atomic unlink's assertAtomicRotationBaselineCoversCommittedFrontier).
 * A device that is behind must not heal; the device holding the full history
 * (typically the author of the uncovered updates) is the one that can.
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
  const committedFrontier = mergeVersionVectors(
    committedUpdates.map((update) => update.partialEndVersionVector),
  );
  for (const baseline of baselines) {
    if (
      !baseline.sourceVersionVector ||
      !satisfiesVersionVector(baseline.sourceVersionVector, committedFrontier)
    ) {
      throw new DocumentMutationError(
        "Document content-key rotation baseline does not cover the committed frontier",
        409,
      );
    }
  }
}
