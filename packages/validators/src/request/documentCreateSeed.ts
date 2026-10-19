import type { z } from "zod";
import type { DocumentSyncRequest } from "./documentSyncSchema";

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
