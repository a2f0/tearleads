import { and, eq } from "drizzle-orm";
import { db } from "../adapters/postgres";
import { objectAccessGrants } from "../schema";
import {
  computeContainerAccessStateHash,
  computeContainerFingerprint,
  getCurrentEpochRow,
  getCurrentEpochRows,
  materializeCurrentContainerAccessState,
  writeContainerAccessEpoch,
} from "./containerAccessEpochs";
import {
  listDescendantContainers,
  prepareRefreshContainerAccessSubtree,
  resolveContainerRecipients,
  resolveDescendantContainerInputs,
} from "./containerAccessTree";
import {
  CONTAINER_OBJECT_TYPE,
  type ContainerAccessExecutor,
  type ContainerAccessState,
  type DescendantContainerRow,
  type ResolvedContainerInputs,
  type SubjectType,
} from "./containerAccessTypes";
import { ContainerCryptoRecipientResolutionError } from "./principalGrantResolver";
import {
  type AccessLevel,
  accessLevelRank,
  isUserPrincipalRecipient,
} from "./recipientPrincipals";

export {
  listDescendantContainerIds,
  listDescendantContainers,
} from "./containerAccessTree";
export { ContainerCryptoRecipientResolutionError } from "./principalGrantResolver";

const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

function isUuidString(value: string): boolean {
  return new RegExp(UUID_PATTERN).test(value);
}

export async function initializeContainerAccess(
  containerId: string,
  executor: ContainerAccessExecutor = db,
  options: {
    inheritedFrom?: ContainerAccessState;
  } = {},
): Promise<number> {
  const currentEpochRow = await getCurrentEpochRow(containerId, executor);
  if (currentEpochRow) {
    return currentEpochRow.epoch;
  }

  const inheritedState = options.inheritedFrom;
  const {
    ancestorContainerIds,
    cryptoRecipients,
    grants,
    referencedPrincipals,
  } = inheritedState
    ? {
        ancestorContainerIds: [
          ...inheritedState.ancestorContainerIds,
          containerId,
        ],
        cryptoRecipients: inheritedState.cryptoRecipients,
        grants: inheritedState.grants,
        referencedPrincipals: inheritedState.referencedPrincipals,
      }
    : await resolveContainerRecipients(containerId, executor);
  const accessFingerprint = await computeContainerFingerprint({
    containerId,
    ancestorContainerIds,
    grants,
    cryptoRecipients,
  });
  const accessStateHash = await computeContainerAccessStateHash({
    containerId,
    ancestorContainerIds,
    grants,
    referencedPrincipals,
  });

  const initialEpoch = 1;
  await writeContainerAccessEpoch(
    containerId,
    initialEpoch,
    accessFingerprint,
    accessStateHash,
    executor,
  );
  return initialEpoch;
}

export async function refreshContainerAccessSubtree(
  containerId: string,
  executor: ContainerAccessExecutor = db,
  options: {
    descendantContainers?: ReadonlyArray<DescendantContainerRow>;
  } = {},
): Promise<Map<string, number>> {
  const descendantContainers = options.descendantContainers
    ? [...options.descendantContainers]
    : await listDescendantContainers(containerId, executor);
  const descendantIds = descendantContainers.map((container) => container.id);
  const currentEpochByContainerId = await getCurrentEpochRows(
    descendantIds,
    executor,
  );
  const epochByContainerId = new Map<string, number>();
  const {
    directGrantsByContainerId,
    directResolvedInputsByContainerId,
    grantResolver,
    rootResolvedInputs,
  } = await prepareRefreshContainerAccessSubtree({
    containerId,
    descendantIds,
    executor,
  });
  const resolvedInputsByContainerId = new Map<
    string,
    ResolvedContainerInputs
  >();

  for (const descendantContainer of descendantContainers) {
    const currentEpochRow =
      currentEpochByContainerId.get(descendantContainer.id) ?? null;
    const resolvedInputs = resolveDescendantContainerInputs(
      descendantContainer,
      containerId,
      rootResolvedInputs,
      resolvedInputsByContainerId,
      directGrantsByContainerId,
      directResolvedInputsByContainerId,
    );
    const cryptoRecipients = await grantResolver.buildCryptoRecipients(
      resolvedInputs.grants,
    );
    const accessFingerprint = await computeContainerFingerprint({
      containerId: descendantContainer.id,
      ancestorContainerIds: resolvedInputs.ancestorContainerIds,
      grants: resolvedInputs.grants,
      cryptoRecipients,
    });
    const accessStateHash = await computeContainerAccessStateHash({
      containerId: descendantContainer.id,
      ancestorContainerIds: resolvedInputs.ancestorContainerIds,
      grants: resolvedInputs.grants,
      referencedPrincipals: resolvedInputs.referencedPrincipals,
    });

    resolvedInputsByContainerId.set(descendantContainer.id, resolvedInputs);

    if (
      currentEpochRow &&
      currentEpochRow.accessFingerprint === accessFingerprint &&
      currentEpochRow.accessStateHash === accessStateHash
    ) {
      epochByContainerId.set(descendantContainer.id, currentEpochRow.epoch);
      continue;
    }

    const nextEpoch = currentEpochRow === null ? 1 : currentEpochRow.epoch + 1;
    await writeContainerAccessEpoch(
      descendantContainer.id,
      nextEpoch,
      accessFingerprint,
      accessStateHash,
      executor,
    );
    epochByContainerId.set(descendantContainer.id, nextEpoch);
  }

  return epochByContainerId;
}

export async function grantContainerAccess(
  input: {
    containerId: string;
    subjectType: SubjectType;
    subjectId: string;
    accessLevel: AccessLevel;
  },
  executor: ContainerAccessExecutor = db,
): Promise<number> {
  if (!isUuidString(input.subjectId)) {
    throw new Error(
      `Container grant subjectId must be a UUID for subjectType ${input.subjectType}`,
    );
  }

  const grantAccess = async (tx: ContainerAccessExecutor) => {
    await tx
      .delete(objectAccessGrants)
      .where(
        and(
          eq(objectAccessGrants.objectType, CONTAINER_OBJECT_TYPE),
          eq(objectAccessGrants.objectId, input.containerId),
          eq(objectAccessGrants.subjectType, input.subjectType),
          eq(objectAccessGrants.subjectId, input.subjectId),
        ),
      );

    await tx.insert(objectAccessGrants).values({
      objectType: CONTAINER_OBJECT_TYPE,
      objectId: input.containerId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      accessLevel: input.accessLevel,
    });

    const epochByContainerId = await refreshContainerAccessSubtree(
      input.containerId,
      tx,
    );

    return epochByContainerId.get(input.containerId) ?? 1;
  };

  if (executor === db) {
    return db.transaction(grantAccess);
  }

  return grantAccess(executor);
}

export async function resolveContainerAccessState(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<ContainerAccessState | null> {
  const currentEpochRow = await getCurrentEpochRow(containerId, executor);
  if (!currentEpochRow) {
    return null;
  }

  let resolvedRecipients: Awaited<
    ReturnType<typeof resolveContainerRecipients>
  >;

  try {
    resolvedRecipients = await resolveContainerRecipients(
      containerId,
      executor,
    );
  } catch (error) {
    if (error instanceof ContainerCryptoRecipientResolutionError) {
      return null;
    }

    throw error;
  }

  const {
    ancestorContainerIds,
    effectiveRecipients,
    cryptoRecipients,
    grants,
    referencedPrincipals,
  } = resolvedRecipients;
  const {
    accessFingerprint,
    accessStateHash,
    currentEpochRow: materializedEpochRow,
  } = await materializeCurrentContainerAccessState({
    containerId,
    currentEpochRow,
    executor,
    resolvedRecipients,
  });

  return {
    currentAccessEpoch: materializedEpochRow.epoch,
    accessFingerprint,
    accessStateHash,
    ancestorContainerIds,
    grants,
    referencedPrincipals,
    effectiveRecipients,
    cryptoRecipients,
  };
}

export function canReadContainerAccess(
  state: ContainerAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some((recipient) =>
    isUserPrincipalRecipient(recipient, userId),
  );
}

export function canWriteContainerAccess(
  state: ContainerAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) =>
      isUserPrincipalRecipient(recipient, userId) &&
      accessLevelRank(recipient.accessLevel) >= accessLevelRank("write"),
  );
}

export function canAdminContainerAccess(
  state: ContainerAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) =>
      isUserPrincipalRecipient(recipient, userId) &&
      recipient.accessLevel === "admin",
  );
}
