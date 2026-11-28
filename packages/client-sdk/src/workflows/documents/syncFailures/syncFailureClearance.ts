interface SyncFailureClearancePass {
  readonly exhaustedPendingUpdateCount: number;
  readonly plan: {
    readonly request: { readonly pullCursor?: string | undefined };
  };
}

/**
 * A cursor continuation or a parked pull-only pass intentionally defers every
 * queued write. Its success therefore cannot clear a terminal failure recorded
 * by an earlier write-bearing pass (such as `document_peer_restore_awaits_owner`).
 * A continuation with no queued writes can still clear a read-only revalidation
 * failure, and a later write-bearing pass can clear the failure once it has no
 * exhausted updates.
 */
export function shouldClearDocumentSyncFailureAfterPass(
  pass: SyncFailureClearancePass,
  outgoingUpdateCount: number,
  writesDeferred = false,
): boolean {
  return (
    !writesDeferred &&
    pass.exhaustedPendingUpdateCount === 0 &&
    (pass.plan.request.pullCursor === undefined || outgoingUpdateCount === 0)
  );
}
