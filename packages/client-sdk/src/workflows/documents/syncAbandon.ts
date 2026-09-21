import type { ContainerKekRepairInaccessibleError } from "../../data/documents/shared/containerKekCurrency";
import type { DocumentSyncSubmitFailure } from "../../data/documents/shared/types";
import type { SyncRemoteDocumentInput } from "./readOnlySync";
import { DocumentAncestorRepairAbandonedError } from "./syncRepairAbandon";
import { traceAncestorRepairAbandoned } from "./syncTrace";

/** The ways a sync pass gives up without failing: writes stay queued. */
type AbandonedSyncInput = Pick<
  SyncRemoteDocumentInput,
  "documentId" | "onSyncAbandoned" | "onSyncTrace" | "onTerminalSubmitFailure"
>;

export function abandonAncestorRepair(
  input: AbandonedSyncInput,
  error: DocumentAncestorRepairAbandonedError,
): null {
  // Trace as well as abandon: the store's onSyncAbandoned only parks the
  // document, and this path may already have issued server-side rekeys, so
  // abandoning untraced would leave a retrying loop with no way to see it.
  traceAncestorRepairAbandoned(input.onSyncTrace, {
    documentId: input.documentId,
    reason: error.reason,
  });
  input.onSyncAbandoned?.(error.reason);
  return null;
}

/**
 * The stale ancestor is one this writer can neither re-key nor be given the
 * key for, and one refetch has already confirmed nobody repaired it yet. The
 * writes stay queued; the durable row tells the write queue why, and the
 * dependent-path hint that follows the repair re-arms the pass.
 */
export async function abandonInaccessibleAncestorRepair(
  input: AbandonedSyncInput,
  error: ContainerKekRepairInaccessibleError,
): Promise<null> {
  await input.onTerminalSubmitFailure?.({
    code: "document_ancestor_repair_inaccessible",
    message: error.message,
    ok: false,
    report: () => undefined,
    status: null,
  });
  return abandonAncestorRepair(
    input,
    new DocumentAncestorRepairAbandonedError("inaccessible"),
  );
}

export function abandonAfterRetryableConflicts(
  input: AbandonedSyncInput,
): null {
  input.onSyncAbandoned?.("every sync attempt hit a retryable conflict");
  return null;
}

export async function abandonOversizedSyncPlan(
  input: AbandonedSyncInput,
  error: Error,
): Promise<null> {
  const failure: DocumentSyncSubmitFailure = {
    code: "document_sync_request_too_large",
    message: error.message,
    ok: false,
    report: () => undefined,
    status: null,
  };
  await input.onTerminalSubmitFailure?.(failure);
  input.onSyncAbandoned?.(
    "a queued update cannot fit within the document sync request limit",
  );
  return null;
}
