interface SeatUserPriorityInput {
  readonly activeAdminUserIds: readonly string[];
  readonly activeUserIds: readonly string[];
  readonly previouslyAssignedUserIds?: readonly string[];
}

/** Preserves historic seats, then favors admins who can manage capacity. */
export function prioritizeSeatUserIds(input: SeatUserPriorityInput): string[] {
  const activeUserIdSet = new Set(input.activeUserIds);
  const preferredUserIds: string[] = [];
  const seenUserIds = new Set<string>();
  const append = (userIds: readonly string[]) => {
    for (const userId of userIds) {
      if (activeUserIdSet.has(userId) && !seenUserIds.has(userId)) {
        preferredUserIds.push(userId);
        seenUserIds.add(userId);
      }
    }
  };
  append(input.previouslyAssignedUserIds ?? []);
  append([...input.activeAdminUserIds].sort());
  append([...input.activeUserIds].sort());
  return preferredUserIds;
}
