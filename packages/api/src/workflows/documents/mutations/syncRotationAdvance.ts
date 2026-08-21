import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import { documentUpdates } from "@symcrypt/api-shared/schema";
import { mergeVersionVectors, satisfiesVersionVector } from "@symcrypt/loro";
import type {
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@symcrypt/validators/request";
import { eq, inArray } from "drizzle-orm";
import { getLatestDocumentContentKeyEpoch } from "../../../access/read/documentContentKeyStore";
import { DocumentMutationError } from "./errors";
import { readWriteHeader } from "./shared/records";

async function listCommittedBaselineIds(
  executor: DatabaseTransaction,
  baselines: readonly DocumentOutgoingUpdate[],
): Promise<Set<string>> {
  const rows = await executor
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(
      inArray(
        documentUpdates.id,
        baselines.map((baseline) => baseline.id),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

function assertNewBaselineSound(input: {
  readonly baseline: DocumentOutgoingUpdate;
  readonly committedFrontier: string;
  readonly requestContentKeyEpoch: number;
}): void {
  const header = readWriteHeader(
    input.baseline.writeHeader,
    "Document rotation baseline write header",
  );
  if (header.contentKeyEpoch !== input.requestContentKeyEpoch) {
    throw new DocumentMutationError(
      "Document content-key rotation baseline must use the request content-key epoch",
      409,
    );
  }
  // The wire schema only requires a non-empty string; an undecodable vector
  // must surface as a client error, not a 500 out of the vector decoder.
  let coversCommittedFrontier: boolean;
  try {
    coversCommittedFrontier =
      !!input.baseline.sourceVersionVector &&
      satisfiesVersionVector(
        input.baseline.sourceVersionVector,
        input.committedFrontier,
      );
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

/**
 * Soundness gate for rotation baselines arriving via document sync.
 *
 * A request that ADVANCES the content-key epoch is a rotation (e.g. the
 * stale-bundle heal after a container KEK rotation). Rotated-away epochs
 * become undecryptable for every reader, so the advance must be anchored by a
 * NEWLY WRITTEN rotation baseline that dominates the whole committed
 * frontier — otherwise uncovered old-epoch updates are served forever, poison
 * every reader's all-or-nothing decrypt, and the document never converges
 * (mirrors the atomic unlink's
 * assertAtomicRotationBaselineCoversCommittedFrontier). A replayed,
 * already-committed baseline id cannot anchor it: the append path's
 * idempotent-retry equality check would keep its ORIGINAL (old-epoch) write
 * header, advancing the epoch without a baseline readable under the new key.
 *
 * The same coverage rule applies to every OTHER newly written baseline too:
 * the redirect reads the NEWEST authenticated baseline at the current epoch,
 * so a later under-covering baseline (e.g. a pre-heal checkpoint replayed
 * after a lost heal ack) would silently shrink coverage below an existing
 * covering baseline. Idempotent retries of already-committed baseline ids are
 * exempt — they insert nothing.
 *
 * A device that is behind must not rotate yet. It can first rematerialize the
 * missing updates through the container predecessor-KEK chain and then retry
 * with a covering baseline; no other device is required. Rejecting a partial
 * baseline preserves the missing data instead of making it the redirect head.
 */
export async function assertSyncRotationBaselinesSound(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}): Promise<void> {
  const bundle = input.request.contentKeyBundle;
  const baselines = input.request.outgoingUpdates.filter(
    (update) => update.checkpointKind === "rotate_baseline",
  );
  let advancesEpoch = false;
  if (bundle) {
    const latestEpoch = await getLatestDocumentContentKeyEpoch(
      input.documentId,
      input.executor,
    );
    advancesEpoch =
      latestEpoch !== null && bundle.contentKeyEpoch > latestEpoch;
  }
  if (baselines.length === 0 && !advancesEpoch) {
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
  if (baselines.length === 0) {
    throw new DocumentMutationError(
      "Document content-key rotation requires a rotation baseline covering committed updates",
      409,
    );
  }

  const committedBaselineIds = await listCommittedBaselineIds(
    input.executor,
    baselines,
  );
  if (advancesEpoch && committedBaselineIds.size > 0) {
    throw new DocumentMutationError(
      "Document content-key rotation baseline must be newly written",
      409,
    );
  }
  const newBaselines = baselines.filter(
    (baseline) => !committedBaselineIds.has(baseline.id),
  );
  if (advancesEpoch && newBaselines.length === 0) {
    throw new DocumentMutationError(
      "Document content-key rotation requires a rotation baseline covering committed updates",
      409,
    );
  }

  const committedFrontier = mergeVersionVectors(
    committedUpdates.map((update) => update.partialEndVersionVector),
  );
  for (const baseline of newBaselines) {
    assertNewBaselineSound({
      baseline,
      committedFrontier,
      requestContentKeyEpoch: input.request.contentKeyEpoch,
    });
  }
}
