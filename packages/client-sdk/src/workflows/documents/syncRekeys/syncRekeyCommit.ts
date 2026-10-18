import { serializeKeyingCanonicalJson, toFingerprint } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";

const textEncoder = new TextEncoder();

/**
 * Identifies one logical inline-rekey flush across plan rematerialization.
 * Rotation baselines and signed rekey events can be freshly randomized on a
 * retry. The durable FIFO head and pre-rekey projection stay stable even when
 * a new local edit is appended to the queue after a response is lost.
 */
export async function computeInlineRekeyCommitId(input: {
  readonly headPendingUpdateId: string;
  readonly projection: DocumentWriterProjectionResponse;
}): Promise<string> {
  return toFingerprint(
    textEncoder.encode(
      serializeKeyingCanonicalJson({
        domain: "tearleads.document-sync.inline-rekey-commit",
        documentId: input.projection.documentId,
        headPendingUpdateId: input.headPendingUpdateId,
        predecessorTargetHash:
          input.projection.documentKekTargets.documentKeyTargetHash,
        version: 1,
      }),
    ),
  );
}
