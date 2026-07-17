interface ContainerMutationBatchLockPlan {
  readonly groupIds: readonly string[];
  readonly organizationIds: readonly string[];
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** Stable lock keys; callers acquire every group before any organization. */
export function planContainerMutationBatchLocks(input: {
  readonly groupIds: Iterable<string>;
  readonly organizationIds: Iterable<string>;
}): ContainerMutationBatchLockPlan {
  return {
    groupIds: uniqueSorted(input.groupIds),
    organizationIds: uniqueSorted(input.organizationIds),
  };
}
