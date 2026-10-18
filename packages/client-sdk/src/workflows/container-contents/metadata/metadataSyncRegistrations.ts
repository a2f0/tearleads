export function preRegisterMaterializedContainerMetadataUpdateIds(
  locallyAcceptedUpdateIds: Set<string> | undefined,
  registeredUpdateIds: string[],
  materializedUpdateIds: readonly string[],
): void {
  const alreadyRegistered = new Set(registeredUpdateIds);
  for (const updateId of materializedUpdateIds) {
    if (alreadyRegistered.has(updateId)) continue;
    alreadyRegistered.add(updateId);
    registeredUpdateIds.push(updateId);
    locallyAcceptedUpdateIds?.add(updateId);
  }
}

function discardUnacceptedContainerMetadataUpdateIds(
  locallyAcceptedUpdateIds: Set<string> | undefined,
  sentUpdateIds: readonly string[],
  acceptedUpdateIds: readonly string[],
): void {
  if (!locallyAcceptedUpdateIds) return;
  const acceptedOutgoing = new Set(acceptedUpdateIds);
  for (const sentUpdateId of sentUpdateIds) {
    if (!acceptedOutgoing.has(sentUpdateId)) {
      locallyAcceptedUpdateIds.delete(sentUpdateId);
    }
  }
}

export async function cleanupContainerMetadataRegistrationsOnFailure<T>(
  locallyAcceptedUpdateIds: Set<string> | undefined,
  sentUpdateIds: readonly string[],
  task: () => Promise<T | null>,
): Promise<T | null> {
  try {
    const result = await task();
    if (result === null) {
      discardUnacceptedContainerMetadataUpdateIds(
        locallyAcceptedUpdateIds,
        sentUpdateIds,
        [],
      );
    }
    return result;
  } catch (error) {
    discardUnacceptedContainerMetadataUpdateIds(
      locallyAcceptedUpdateIds,
      sentUpdateIds,
      [],
    );
    throw error;
  }
}

export { discardUnacceptedContainerMetadataUpdateIds };
