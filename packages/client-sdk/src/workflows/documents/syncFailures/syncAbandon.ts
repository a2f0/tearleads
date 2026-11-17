import type { ContainerKekRepairInaccessibleError } from "../../../data/documents/shared/containerKek/containerKekCurrency";
import type { DocumentSyncSubmitFailure } from "../../../data/documents/shared/sync/syncSubmitFailure";
import type { RemoteDocumentSyncPass } from "../sync/remoteDocumentSyncPass";
import { traceAncestorRepairAbandoned } from "../sync/syncTrace";
import { DocumentAncestorRepairAbandonedError } from "./syncRepairAbandon";

/** The ways a sync pass gives up without failing: writes stay queued. */
type AbandonedSyncInput = Pick<
  RemoteDocumentSyncPass,
  "documentId" | "onSyncAbandoned" | "onSyncTrace" | "onTerminalSubmitFailure"
>;

/**
 * Whether the pass finishes a pull that already fetched a page: it resumes
 * from a cursor, or restarts after its cursor expired.
 */
export function isPullUnderWay(
  input: Pick<
    RemoteDocumentSyncPass,
    "pullContinuation" | "pullRecoveryRequired"
  >,
): boolean {
  return (
    input.pullContinuation !== undefined || input.pullRecoveryRequired === true
  );
}

/**
 * Whether a held organization stops this read-only pass. Only the start of a
 * routine pull of a document the device has already pulled is held. A first
 * pull still runs, so a document the device has listed can still be opened;
 * a pull that has fetched a page runs to its end, first pull or not, even
 * when an expired cursor makes it start over, so no document is left half
 * pulled; and so does an explicit read of raw history.
 */
export function isRoutinePullHeld(
  input: Pick<
    RemoteDocumentSyncPass,
    | "historyMode"
    | "isRemoteSyncBlocked"
    | "minLsn"
    | "pullContinuation"
    | "pullRecoveryRequired"
  >,
  organizationId: string,
): boolean {
  return (
    input.historyMode !== "raw" &&
    !isPullUnderWay(input) &&
    input.minLsn !== undefined &&
    (input.isRemoteSyncBlocked?.(organizationId, "pull") ?? false)
  );
}

export function abandonBlockedSync(input: AbandonedSyncInput): null {
  input.onSyncTrace?.(`document sync blocked document=${input.documentId}`);
  input.onSyncAbandoned?.("blocked");
  return null;
}

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
