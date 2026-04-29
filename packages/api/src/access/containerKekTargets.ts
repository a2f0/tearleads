import type { ContainerKekTargetV2 } from "@tearleads/crypto";
import { inArray } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import { accessManifests } from "../schema";
import { getCurrentAccessManifestHeads } from "./accessManifestStore";
import { getContainerKeyEpochsById } from "./containerKekStore";

type ContainerKekTargetExecutor = DatabaseExecutor;

type ContainerKekTargetStatus = 404 | 409;

export class ContainerKekTargetError extends Error {
  constructor(
    message: string,
    readonly status: ContainerKekTargetStatus,
  ) {
    super(message);
    this.name = "ContainerKekTargetError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface ContainerManifestStateProjection {
  readonly containerId?: unknown;
  readonly containerKeyEpochId?: unknown;
  readonly version?: unknown;
}

function readContainerKeyEpochId(input: {
  readonly containerId: string;
  readonly state: unknown;
}): string {
  if (!isRecord(input.state)) {
    throw new ContainerKekTargetError(
      "Container V2 manifest state is invalid",
      409,
    );
  }

  const state = input.state as ContainerManifestStateProjection;
  if (state.version !== 2 || state.containerId !== input.containerId) {
    throw new ContainerKekTargetError(
      "Container V2 manifest state mismatch",
      409,
    );
  }

  const containerKeyEpochId = state.containerKeyEpochId;
  if (typeof containerKeyEpochId !== "string" || !containerKeyEpochId) {
    throw new ContainerKekTargetError(
      "Container V2 manifest has no current KEK epoch",
      409,
    );
  }

  return containerKeyEpochId;
}

type ContainerManifestTarget = {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly containerManifestHash: string;
};

type CurrentContainerHeadMap = Awaited<
  ReturnType<typeof getCurrentAccessManifestHeads>
>;

async function loadCurrentContainerManifestTargets(input: {
  readonly containerHeadById: CurrentContainerHeadMap;
  readonly containerIds: readonly string[];
  readonly executor: ContainerKekTargetExecutor;
}): Promise<ContainerManifestTarget[]> {
  const manifestHashes = input.containerIds.map((containerId) => {
    const head = input.containerHeadById.get(containerId);
    if (!head) {
      throw new ContainerKekTargetError(
        "Container V2 manifest head missing",
        409,
      );
    }
    return head.manifestHash;
  });
  const manifestRows = await input.executor
    .select({
      manifestHash: accessManifests.manifestHash,
      objectId: accessManifests.objectId,
      objectKind: accessManifests.objectKind,
      state: accessManifests.state,
    })
    .from(accessManifests)
    .where(inArray(accessManifests.manifestHash, manifestHashes));
  const manifestByHash = new Map(
    manifestRows.map((row) => [row.manifestHash, row]),
  );

  return input.containerIds.map((containerId) => {
    const head = input.containerHeadById.get(containerId);
    if (!head) {
      throw new ContainerKekTargetError(
        "Container V2 manifest head missing",
        409,
      );
    }

    const manifest = manifestByHash.get(head.manifestHash);
    if (
      !manifest ||
      manifest.objectKind !== "container" ||
      manifest.objectId !== containerId
    ) {
      throw new ContainerKekTargetError(
        "Container V2 manifest bundle mismatch",
        409,
      );
    }

    return {
      containerId,
      containerManifestHash: head.manifestHash,
      containerKeyEpochId: readContainerKeyEpochId({
        containerId,
        state: manifest.state,
      }),
    };
  });
}

export async function resolveCurrentContainerKekTargets(
  containerIds: readonly string[],
  executor: ContainerKekTargetExecutor = db,
): Promise<Map<string, ContainerKekTargetV2>> {
  const uniqueContainerIds = [...new Set(containerIds)].sort();

  if (uniqueContainerIds.length === 0) {
    return new Map();
  }

  const containerHeadById = await getCurrentAccessManifestHeads(
    "container",
    uniqueContainerIds,
    executor,
  );
  const manifestTargets = await loadCurrentContainerManifestTargets({
    containerHeadById,
    containerIds: uniqueContainerIds,
    executor,
  });
  const keyEpochById = await getContainerKeyEpochsById(
    manifestTargets.map((target) => target.containerKeyEpochId),
    executor,
  );

  return new Map(
    manifestTargets.map((target) => {
      const keyEpoch = keyEpochById.get(target.containerKeyEpochId);
      if (!keyEpoch) {
        throw new ContainerKekTargetError(
          "Container V2 KEK epoch missing",
          409,
        );
      }

      if (keyEpoch.containerId !== target.containerId) {
        throw new ContainerKekTargetError(
          "Container V2 KEK epoch is stale",
          409,
        );
      }

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
