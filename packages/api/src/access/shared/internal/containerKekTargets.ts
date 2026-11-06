import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { ContainerKekTarget } from "@tearleads/crypto";
import { uniqueSortedStrings as unique } from "../../../utils/array";
import { getContainerKeyEpochsById } from "./containerKekStore";
import { loadCurrentContainerManifestTargetClosure } from "./containerKekTargetClosure";
import {
  ContainerKekTargetError,
  type ContainerKekTargetStatus,
  staleContainerKekEpochError,
  staleContainerKekParentEdgeError,
} from "./containerKekTargetError";
import {
  type ContainerManifestBindingHistory,
  loadSameEpochContainerManifestBindingHistories,
} from "./containerManifestBindingHistory";
import type { ContainerManifestTarget } from "./containerManifestTargetState";

type ContainerKeyEpochById = Awaited<
  ReturnType<typeof getContainerKeyEpochsById>
>;

export async function resolveCurrentContainerKekTargetsMapped<E extends Error>(
  containerIds: readonly string[],
  executor: DatabaseSession,
  mapError: (
    message: string,
    status: ContainerKekTargetStatus,
    stale: boolean,
  ) => E,
  allowHistoricalParentEpochs = false,
): Promise<Map<string, ContainerKekTarget>> {
  try {
    return await resolveCurrentContainerKekTargets(
      containerIds,
      executor,
      allowHistoricalParentEpochs,
    );
  } catch (error) {
    if (error instanceof ContainerKekTargetError) {
      throw mapError(error.message, error.status, error.stale);
    }
    throw error;
  }
}

function getContainerKeyEpoch(
  target: ContainerManifestTarget,
  keyEpochById: ContainerKeyEpochById,
) {
  const keyEpoch = keyEpochById.get(target.containerKeyEpochId);
  if (!keyEpoch) {
    throw new ContainerKekTargetError(
      `Container KEK epoch missing for container ${target.containerId}`,
      409,
    );
  }
  if (keyEpoch.containerId !== target.containerId) {
    throw staleContainerKekEpochError(target.containerId);
  }

  return keyEpoch;
}

function assertContainerKekParentEdgesCurrent(input: {
  readonly keyEpochById: ContainerKeyEpochById;
  readonly targetByContainerId: ReadonlyMap<string, ContainerManifestTarget>;
  readonly allowHistoricalParentEpochs: boolean;
}): void {
  for (const target of input.targetByContainerId.values()) {
    const keyEpoch = getContainerKeyEpoch(target, input.keyEpochById);

    if (target.parentContainerId === null) {
      if (keyEpoch.parentContainerKeyEpochId !== null) {
        throw staleContainerKekParentEdgeError(target.containerId);
      }
      continue;
    }

    const parentTarget = input.targetByContainerId.get(
      target.parentContainerId,
    );
    if (!parentTarget) {
      throw new ContainerKekTargetError(
        `Container KEK parent target is missing for container ${target.containerId} (parent: ${target.parentContainerId})`,
        409,
      );
    }

    // Future document/blob writes must not keep using a descendant KEK that is
    // still reachable through an older ancestor KEK. The writer projection route
    // intentionally remains available so an authorized client can materialize a
    // signed container.rekey repair before retrying the content write.
    if (
      !input.allowHistoricalParentEpochs &&
      keyEpoch.parentContainerKeyEpochId !== parentTarget.containerKeyEpochId
    ) {
      throw staleContainerKekParentEdgeError(target.containerId);
    }
  }
}

function assertContainerKekManifestBindingsCurrent(input: {
  readonly historyByContainerId: ReadonlyMap<
    string,
    ContainerManifestBindingHistory
  >;
  readonly keyEpochById: ContainerKeyEpochById;
  readonly targetByContainerId: ReadonlyMap<string, ContainerManifestTarget>;
}): void {
  for (const target of input.targetByContainerId.values()) {
    const keyEpoch = getContainerKeyEpoch(target, input.keyEpochById);
    const history = input.historyByContainerId.get(target.containerId);

    if (
      !history?.manifestHashes.has(keyEpoch.accessManifestHash) ||
      !history.manifestHashes.has(keyEpoch.createdByManifestHash) ||
      history.eventHashByManifestHash.get(keyEpoch.createdByManifestHash) !==
        keyEpoch.createdByEventHash
    ) {
      throw staleContainerKekEpochError(target.containerId);
    }
  }
}

export async function resolveCurrentContainerKekTargets(
  containerIds: readonly string[],
  executor: DatabaseSession,
  allowHistoricalParentEpochs = false,
): Promise<Map<string, ContainerKekTarget>> {
  const uniqueContainerIds = unique(containerIds);

  if (uniqueContainerIds.length === 0) {
    return new Map();
  }

  const targetByContainerId = await loadCurrentContainerManifestTargetClosure({
    containerIds: uniqueContainerIds,
    executor,
  });
  const keyEpochById = await getContainerKeyEpochsById(
    [...targetByContainerId.values()].map(
      (target) => target.containerKeyEpochId,
    ),
    executor,
  );
  assertContainerKekParentEdgesCurrent({
    keyEpochById,
    targetByContainerId,
    allowHistoricalParentEpochs,
  });
  const historyByContainerId =
    await loadSameEpochContainerManifestBindingHistories({
      executor,
      targetByContainerId,
    });
  assertContainerKekManifestBindingsCurrent({
    historyByContainerId,
    keyEpochById,
    targetByContainerId,
  });

  return new Map(
    uniqueContainerIds.map((containerId) => {
      const target = targetByContainerId.get(containerId);
      if (!target) {
        throw new ContainerKekTargetError(
          "Container manifest head missing",
          409,
        );
      }
      const keyEpoch = getContainerKeyEpoch(target, keyEpochById);

      return [
        target.containerId,
        {
          containerId: target.containerId,
          containerManifestHash: target.containerManifestHash,
          containerKeyEpochId: keyEpoch.id,
          containerKeyEpoch: keyEpoch.keyEpoch,
        },
      ] as const;
    }),
  );
}
