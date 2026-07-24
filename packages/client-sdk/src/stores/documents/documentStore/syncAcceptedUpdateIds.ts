import type { DocumentStoreState } from "./state";

export function discardPreRegisteredUpdateIds(
  state: DocumentStoreState,
  sentUpdateIds: readonly string[],
): void {
  for (const sentUpdateId of sentUpdateIds) {
    state.locallyAcceptedUpdateIds.delete(sentUpdateId);
  }
}

export function preRegisterUpdateIds(
  state: DocumentStoreState,
  pendingUpdates: ReadonlyArray<{ readonly id: string }>,
): string[] {
  const sentUpdateIds = pendingUpdates.map((update) => update.id);
  for (const sentUpdateId of sentUpdateIds) {
    state.locallyAcceptedUpdateIds.add(sentUpdateId);
  }
  return sentUpdateIds;
}

export function discardUnacceptedPreRegisteredUpdateIds(
  state: DocumentStoreState,
  sentUpdateIds: readonly string[],
  acceptedUpdateIds: readonly string[],
): void {
  const accepted = new Set(acceptedUpdateIds);
  for (const sentUpdateId of sentUpdateIds) {
    if (!accepted.has(sentUpdateId)) {
      state.locallyAcceptedUpdateIds.delete(sentUpdateId);
    }
  }
}

export async function cleanupPreRegisteredUpdateIdsOnFailure<T>(
  state: DocumentStoreState,
  sentUpdateIds: readonly string[],
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    discardPreRegisteredUpdateIds(state, sentUpdateIds);
    throw error;
  }
}
