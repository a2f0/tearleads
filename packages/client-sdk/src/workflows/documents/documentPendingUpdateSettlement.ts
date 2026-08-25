interface PendingUpdateSettlementInput {
  commitOnlyPendingUpdateIds?: readonly string[] | undefined;
  expectedSyncState?: unknown;
}

/** Commit-only retirements are excluded from same-identity CAS-loss cleanup. */
export function pendingUpdateSettlementForMutation(
  input: PendingUpdateSettlementInput,
  acceptedPendingUpdateIds: readonly string[],
) {
  return {
    acceptedPendingUpdateIds: [
      ...new Set([
        ...acceptedPendingUpdateIds,
        ...(input.commitOnlyPendingUpdateIds ?? []),
      ]),
    ],
    conflictSettledPendingUpdateIds: acceptedPendingUpdateIds,
    settleAcceptedPendingOnConflict: input.expectedSyncState !== undefined,
  };
}
