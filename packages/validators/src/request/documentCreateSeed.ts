import type { z } from "zod";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "../util/documentSyncLimits";
import type { DocumentSyncRequest } from "./documentSyncSchema";

const TEXT_ENCODER = new TextEncoder();

/**
 * A seed is the one update a document is born with, committed in its create
 * transaction: exactly one outgoing update and no container rekeys.
 */
export function refineSingleUpdateSeed(
  seed: DocumentSyncRequest | undefined,
  context: z.RefinementCtx,
  issue: { readonly message: string; readonly path: string },
): void {
  if (!Array.isArray(seed?.outgoingUpdates)) {
    return;
  }
  if (
    seed.outgoingUpdates.length !== 1 ||
    (seed.containerRekeys?.length ?? 0) !== 0
  ) {
    context.addIssue({
      code: "custom",
      message: issue.message,
      path: [issue.path],
    });
  }
}

/**
 * A create seed stands in for the document's first sync, so it is held to the
 * sync request limit the create route's larger ingress ceiling would not apply.
 */
export function refineSeedWithinSyncRequestLimit(
  seed: DocumentSyncRequest | undefined,
  context: z.RefinementCtx,
  path: string,
): void {
  if (
    seed !== undefined &&
    TEXT_ENCODER.encode(JSON.stringify(seed)).byteLength >
      MAX_DOCUMENT_SYNC_REQUEST_BYTES
  ) {
    context.addIssue({
      code: "custom",
      message: `create seed exceeds ${MAX_DOCUMENT_SYNC_REQUEST_BYTES} serialized bytes`,
      path: [path],
    });
  }
}
