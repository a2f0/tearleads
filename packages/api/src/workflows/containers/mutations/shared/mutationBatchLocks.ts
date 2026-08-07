import { uniqueSortedStrings } from "../../../../utils/array";

interface ContainerMutationBatchLockPlan {
  readonly groupIds: readonly string[];
  readonly organizationIds: readonly string[];
}

/** Stable lock keys; callers acquire every group before any organization. */
export function planContainerMutationBatchLocks(input: {
  readonly groupIds: Iterable<string>;
  readonly organizationIds: Iterable<string>;
}): ContainerMutationBatchLockPlan {
  return {
    groupIds: uniqueSortedStrings(input.groupIds),
    organizationIds: uniqueSortedStrings(input.organizationIds),
  };
}
