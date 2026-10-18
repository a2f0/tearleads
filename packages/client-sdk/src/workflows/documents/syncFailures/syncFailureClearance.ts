interface SyncFailureClearancePass {
  readonly exhaustedPendingUpdateCount: number;
  readonly plan: {
    readonly request: { readonly pullCursor?: string | undefined };
  };
}

/**
 * A cursor continuation intentionally defers every queued write. Its success
 * therefore cannot clear a terminal failure recorded by an earlier
 * write-bearing pass. A continuation with no queued writes can still clear a
 * read-only revalidation failure, and a later write-bearing pass can clear
 * the failure once it has no exhausted updates.
 */
export function shouldClearDocumentSyncFailureAfterPass(
  pass: SyncFailureClearancePass,
  outgoingUpdateCount: number,
): boolean {
  return (
    pass.exhaustedPendingUpdateCount === 0 &&
    (pass.plan.request.pullCursor === undefined || outgoingUpdateCount === 0)
  );
}
