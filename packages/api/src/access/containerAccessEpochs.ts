import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../adapters/postgres";
import { objectAccessEpochs } from "../schema";
import { uniqueSortedStrings } from "../utils/array";
import {
  computeAccessFingerprint,
  computeAccessStateHash,
} from "./accessFingerprint";
import {
  CONTAINER_OBJECT_TYPE,
  type ContainerAccessExecutor,
  type CurrentEpochRow,
  type EffectiveContainerRecipient,
  type ResolvedContainerRecipients,
} from "./containerAccessTypes";
import type { AccessGrantRow as ContainerGrantRow } from "./principalGrantResolver";
import { toPrincipalFingerprintRecipient } from "./recipientPrincipals";

export async function getCurrentEpochRow(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<CurrentEpochRow | null> {
  const [row] = await executor
    .select({
      epoch: objectAccessEpochs.epoch,
      accessFingerprint: objectAccessEpochs.accessFingerprint,
      accessStateHash: objectAccessEpochs.accessStateHash,
    })
    .from(objectAccessEpochs)
    .where(
      and(
        eq(objectAccessEpochs.objectType, CONTAINER_OBJECT_TYPE),
        eq(objectAccessEpochs.objectId, containerId),
      ),
    )
    .orderBy(desc(objectAccessEpochs.epoch))
    .limit(1);

  return row ?? null;
}

export async function getCurrentEpochRows(
  containerIds: string[],
  executor: ContainerAccessExecutor = db,
): Promise<Map<string, CurrentEpochRow>> {
  const uniqueContainerIds = uniqueSortedStrings(containerIds);

  if (uniqueContainerIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      containerId: objectAccessEpochs.objectId,
      epoch: objectAccessEpochs.epoch,
      accessFingerprint: objectAccessEpochs.accessFingerprint,
      accessStateHash: objectAccessEpochs.accessStateHash,
    })
    .from(objectAccessEpochs)
    .where(
      and(
        eq(objectAccessEpochs.objectType, CONTAINER_OBJECT_TYPE),
        inArray(objectAccessEpochs.objectId, uniqueContainerIds),
      ),
    )
    .orderBy(desc(objectAccessEpochs.epoch));

  const currentEpochByContainerId = new Map<string, CurrentEpochRow>();

  for (const row of rows) {
    if (currentEpochByContainerId.has(row.containerId)) {
      continue;
    }

    currentEpochByContainerId.set(row.containerId, {
      epoch: row.epoch,
      accessFingerprint: row.accessFingerprint,
      accessStateHash: row.accessStateHash,
    });
  }

  return currentEpochByContainerId;
}

export async function writeContainerAccessEpoch(
  containerId: string,
  epoch: number,
  accessFingerprint: string,
  accessStateHash: string,
  executor: ContainerAccessExecutor = db,
) {
  await executor.insert(objectAccessEpochs).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: containerId,
    epoch,
    accessFingerprint,
    accessStateHash,
    updatedAt: new Date(),
  });
}

export async function computeContainerFingerprint(input: {
  containerId: string;
  ancestorContainerIds: string[];
  grants: ReadonlyArray<ContainerGrantRow>;
  cryptoRecipients: ReadonlyArray<EffectiveContainerRecipient>;
}) {
  return computeAccessFingerprint({
    objectType: CONTAINER_OBJECT_TYPE,
    containerId: input.containerId,
    ancestorContainerIds: input.ancestorContainerIds,
    grants: input.grants,
    recipients: input.cryptoRecipients.map(toPrincipalFingerprintRecipient),
  });
}

export async function computeContainerAccessStateHash(input: {
  containerId: string;
  ancestorContainerIds: string[];
  grants: ReadonlyArray<ContainerGrantRow>;
  referencedPrincipals: ReadonlyArray<ReferencedPrincipalStateResponse>;
}) {
  return computeAccessStateHash({
    objectType: CONTAINER_OBJECT_TYPE,
    containerId: input.containerId,
    ancestorContainerIds: input.ancestorContainerIds,
    grants: input.grants,
    referencedPrincipals: input.referencedPrincipals,
  });
}

export async function materializeCurrentContainerAccessState(input: {
  containerId: string;
  currentEpochRow: CurrentEpochRow;
  executor: ContainerAccessExecutor;
  resolvedRecipients: ResolvedContainerRecipients;
}): Promise<{
  accessFingerprint: string;
  accessStateHash: string;
  currentEpochRow: CurrentEpochRow & { accessStateHash: string };
}> {
  const accessFingerprint = await computeContainerFingerprint({
    containerId: input.containerId,
    ancestorContainerIds: input.resolvedRecipients.ancestorContainerIds,
    grants: input.resolvedRecipients.grants,
    cryptoRecipients: input.resolvedRecipients.cryptoRecipients,
  });
  const accessStateHash = await computeContainerAccessStateHash({
    containerId: input.containerId,
    ancestorContainerIds: input.resolvedRecipients.ancestorContainerIds,
    grants: input.resolvedRecipients.grants,
    referencedPrincipals: input.resolvedRecipients.referencedPrincipals,
  });

  if (
    input.currentEpochRow.accessFingerprint === accessFingerprint &&
    input.currentEpochRow.accessStateHash === accessStateHash
  ) {
    return {
      accessFingerprint,
      accessStateHash,
      currentEpochRow: {
        ...input.currentEpochRow,
        accessStateHash,
      },
    };
  }

  const nextEpoch = input.currentEpochRow.epoch + 1;
  await writeContainerAccessEpoch(
    input.containerId,
    nextEpoch,
    accessFingerprint,
    accessStateHash,
    input.executor,
  );

  return {
    accessFingerprint,
    accessStateHash,
    currentEpochRow: {
      epoch: nextEpoch,
      accessFingerprint,
      accessStateHash,
    },
  };
}
