import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containerSyncTombstones } from "@tearleads/api-shared/schema";
import type {
  ContainerDirectGrant,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { isContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { sql } from "drizzle-orm";
import { storeVerifiedAccessManifestInTransaction } from "../../../../access/write/accessManifestStore";
import { storeVerifiedContainerKekStateInTransaction } from "../../../../access/write/containerKekStore";
import {
  containerAccessManifestStateRecord as accessStateRecord,
  projectionAccessManifestRecord,
  projectionReferencedPrincipalHeadRecord,
  projectionVerifiedAccessEventRecord,
} from "../../../../keyingProjectionRecords";
import {
  KeyingReadAccessError,
  resolveReadableContainerAccess,
} from "../../../keyingReadAccess";
import { appendOrganizationReadModelChangeInTransaction } from "../../../organizations/readModelChanges";
import {
  userIdsForGrant,
  userIdsWithReadableAccessThroughPath,
} from "../../containerPathUsers";
import { createContainerWriterProjectionContext } from "../../writerProjection";
import { markStoredContainerManifest } from "../../writerProjection/markStoredManifest";
import {
  ContainerMutationError,
  mutationStateStale,
  runConflictBoundary,
} from "../errors";
import type { ContainerMutationContext, StoredContainerRow } from "../types";
import type { VerifiedContainerKekMutationState } from "./containerKek";
import {
  containerKekRecipientTargetRecord,
  containerKeyEpochRecord,
  containerKeyWrapRecord,
} from "./containerKekRecords";
import { persistContainerStructure } from "./containerStructure";
import {
  directGrantKey,
  pruneAccessGrantTombstones,
} from "./grantTombstonePruning";
import { loadMutationContainerKekHistory } from "./mutationKekHistory";

function removedDirectGrants(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly previousManifest: VerifiedContainerAccessManifest;
}): ContainerDirectGrant[] {
  const nextGrantKeys = new Set(
    input.manifest.state.directGrants.map(directGrantKey),
  );

  return input.previousManifest.state.directGrants.filter(
    (grant) => !nextGrantKeys.has(directGrantKey(grant)),
  );
}

async function removedGrantUserIds(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly previousManifest: VerifiedContainerAccessManifest;
}): Promise<string[]> {
  const userIds = new Set<string>();

  for (const grant of removedDirectGrants(input)) {
    for (const userId of await userIdsForGrant({
      executor: input.executor,
      grant,
      manifest: input.previousManifest,
    })) {
      userIds.add(userId);
    }
  }

  return Array.from(userIds);
}

async function directUserIdsWithoutReadableContainerAccess(input: {
  readonly containerId: string;
  readonly executor: DatabaseTransaction;
  readonly userIds: readonly string[];
}): Promise<string[]> {
  const accessContext = createContainerWriterProjectionContext(input.executor);
  const inaccessibleUserIds: string[] = [];

  for (const userId of input.userIds) {
    try {
      await resolveReadableContainerAccess({
        containerId: input.containerId,
        context: accessContext,
        executor: input.executor,
        userId,
      });
    } catch (error) {
      if (
        error instanceof KeyingReadAccessError &&
        (error.status === 403 || error.status === 404 || error.status === 409)
      ) {
        inaccessibleUserIds.push(userId);
        continue;
      }

      throw error;
    }
  }

  return inaccessibleUserIds;
}

async function persistAccessRevocationTombstones(input: {
  readonly container: StoredContainerRow;
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
  readonly updatedAt: Date;
}): Promise<void> {
  const { container, executor, manifest, previousManifest, updatedAt } = input;
  if (
    manifest.event.event.eventType !== "container.revoke" ||
    previousManifest === null
  ) {
    return;
  }

  const removedUserIds = await removedGrantUserIds({
    executor,
    manifest,
    previousManifest,
  });
  if (removedUserIds.length === 0) {
    return;
  }

  const revokedUserIds = await directUserIdsWithoutReadableContainerAccess({
    containerId: manifest.state.containerId,
    executor,
    userIds: removedUserIds,
  });
  if (revokedUserIds.length === 0) {
    return;
  }

  const rowUpdates = {
    depth: container.depth,
    organizationId: manifest.state.organizationId,
    parentId: container.parentId,
    reason: "access_revoked" as const,
    rootDiscoveryVisible: true,
    updatedAt,
  };
  await executor
    .insert(containerSyncTombstones)
    .values(
      revokedUserIds.map((userId) => ({
        ...rowUpdates,
        containerId: manifest.state.containerId,
        userId,
      })),
    )
    .onConflictDoUpdate({
      target: [
        containerSyncTombstones.userId,
        containerSyncTombstones.containerId,
      ],
      set: {
        ...rowUpdates,
        rootDiscoveryVisible: sql`${containerSyncTombstones.rootDiscoveryVisible} or excluded.root_discovery_visible`,
      },
    });
}

function previousContainerPathDepth(input: {
  readonly previousContainerPath: readonly VerifiedContainerAccessManifest[];
  readonly previousManifest: VerifiedContainerAccessManifest;
}): number {
  const previousLeaf = input.previousContainerPath.at(-1);
  if (
    !previousLeaf ||
    previousLeaf.manifestHash !== input.previousManifest.manifestHash
  ) {
    throw new ContainerMutationError(
      "container move previous path is invalid",
      409,
    );
  }

  return input.previousContainerPath.length - 1;
}

async function persistMoveAccessLossTombstones(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly previousContainerPath: readonly VerifiedContainerAccessManifest[];
  readonly previousManifest: VerifiedContainerAccessManifest | null;
  readonly updatedAt: Date;
}): Promise<void> {
  const { executor, manifest, previousContainerPath, previousManifest } = input;
  if (
    manifest.event.event.eventType !== "container.move" ||
    previousManifest === null
  ) {
    return;
  }

  const previouslyReadableUserIds = await userIdsWithReadableAccessThroughPath({
    executor,
    path: previousContainerPath,
  });
  if (previouslyReadableUserIds.length === 0) {
    return;
  }

  const inaccessibleUserIds = await directUserIdsWithoutReadableContainerAccess(
    {
      containerId: manifest.state.containerId,
      executor,
      userIds: previouslyReadableUserIds,
    },
  );
  if (inaccessibleUserIds.length === 0) {
    return;
  }

  const rowUpdates = {
    depth: previousContainerPathDepth({
      previousContainerPath,
      previousManifest,
    }),
    organizationId: manifest.state.organizationId,
    parentId: previousManifest.state.parentContainerId,
    reason: "access_revoked" as const,
    rootDiscoveryVisible: false,
    updatedAt: input.updatedAt,
  };
  await executor
    .insert(containerSyncTombstones)
    .values(
      inaccessibleUserIds.map((userId) => ({
        ...rowUpdates,
        containerId: manifest.state.containerId,
        userId,
      })),
    )
    .onConflictDoUpdate({
      target: [
        containerSyncTombstones.userId,
        containerSyncTombstones.containerId,
      ],
      set: {
        ...rowUpdates,
        rootDiscoveryVisible: sql`${containerSyncTombstones.rootDiscoveryVisible} or excluded.root_discovery_visible`,
      },
    });
}

function kekResponseRecord(
  storedKekState: Awaited<
    ReturnType<typeof storeVerifiedContainerKekStateInTransaction>
  >,
  containerManifestHistory: Awaited<
    ReturnType<typeof loadMutationContainerKekHistory>
  >,
  keyring: VerifiedContainerKekMutationState["keyring"],
): ContainerMutationResponse["containerKek"] {
  return {
    containerId: storedKekState.containerId,
    accessManifestHash: storedKekState.accessManifestHash,
    containerKeyEpochId: storedKekState.containerKeyEpochId,
    containerKeyEpoch: storedKekState.containerKeyEpoch,
    keyEpoch: containerKeyEpochRecord(storedKekState.keyEpoch),
    keyEpochHash: storedKekState.keyEpochHash,
    keyTargetHash: storedKekState.keyTargetHash,
    parentContainerKeyEpochId: storedKekState.parentContainerKeyEpochId,
    keyring: keyring ? { ...keyring } : null,
    recipientTargets: storedKekState.recipientTargets.map(
      containerKekRecipientTargetRecord,
    ),
    wraps: storedKekState.wraps.map(containerKeyWrapRecord),
    containerManifestHistory,
  };
}

async function persistMutationTombstones(input: {
  container: StoredContainerRow;
  executor: DatabaseTransaction;
  manifest: VerifiedContainerAccessManifest;
  previousContainerPath: readonly VerifiedContainerAccessManifest[] | undefined;
  previousManifest: VerifiedContainerAccessManifest | null;
  updatedAt: Date;
}): Promise<void> {
  const { container, executor, manifest, previousManifest, updatedAt } = input;
  await persistAccessRevocationTombstones({
    container,
    executor,
    manifest,
    previousManifest,
    updatedAt,
  });
  await pruneAccessGrantTombstones({
    executor,
    manifest,
    previousManifest,
  });
  if (input.previousContainerPath) {
    await persistMoveAccessLossTombstones({
      executor,
      manifest,
      previousContainerPath: input.previousContainerPath,
      previousManifest,
      updatedAt,
    });
  }
}

export async function persistVerifiedMutation(
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest,
  verifiedKekMutation: VerifiedContainerKekMutationState,
  previousManifest: VerifiedContainerAccessManifest | null,
  previousContainerPath?: readonly VerifiedContainerAccessManifest[],
): Promise<ContainerMutationResponse> {
  const { executor } = context;
  const {
    keyring,
    predecessorBridge,
    verifiedState: kekState,
  } = verifiedKekMutation;
  const updatedAt = new Date();
  const container = await persistContainerStructure(
    executor,
    manifest,
    updatedAt,
  );
  const manifestHead = await runConflictBoundary(() =>
    storeVerifiedAccessManifestInTransaction(
      { verifiedManifest: manifest },
      executor,
    ),
  );
  if (manifestHead.manifestHash !== manifest.manifestHash) {
    throw mutationStateStale("Container manifest head is stale");
  }
  await markStoredContainerManifest(executor, manifest.manifestHash);
  context.manifestHeadByContainerId.set(
    manifest.state.containerId,
    manifestHead,
  );
  await persistMutationTombstones({
    container,
    executor,
    manifest,
    previousContainerPath,
    previousManifest,
    updatedAt,
  });
  const storedKekState = await runConflictBoundary(() =>
    storeVerifiedContainerKekStateInTransaction(
      { keyring, predecessorBridge, verifiedState: kekState },
      executor,
    ),
  );

  const containerManifestHistory = await loadMutationContainerKekHistory(
    context.writerProjectionContext,
    manifest,
    kekState,
  );
  await appendOrganizationReadModelChangeInTransaction(executor, {
    organizationId: manifest.state.organizationId,
    lane: "grants",
    entityId: manifest.state.organizationId,
    operation: "replace",
  });

  const systemSlot = isContainerSystemSlot(container.systemSlot)
    ? container.systemSlot
    : null;

  return {
    ...(systemSlot ? { systemSlot } : {}),
    containerId: manifest.state.containerId,
    createdAt: container.createdAt.toISOString(),
    organizationId: manifest.state.organizationId,
    parentId: manifest.state.parentContainerId,
    updatedAt: container.updatedAt.toISOString(),
    manifestHead: {
      epoch: manifestHead.epoch,
      manifestHash: manifestHead.manifestHash,
    },
    accessManifest: {
      event: projectionVerifiedAccessEventRecord(manifest.event),
      manifest: projectionAccessManifestRecord(manifest.manifest),
      manifestHash: manifest.manifestHash,
      state: accessStateRecord(manifest.state),
    },
    containerKek: kekResponseRecord(
      storedKekState,
      containerManifestHistory,
      keyring,
    ),
    referencedPrincipalHeads: manifest.state.referencedPrincipalHeads.map(
      projectionReferencedPrincipalHeadRecord,
    ),
  };
}
