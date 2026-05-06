import type {
  ContainerDirectGrant,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { eq, sql } from "drizzle-orm";
import { storeVerifiedAccessManifestInTransaction } from "../../../../access/write/accessManifestStore";
import { storeVerifiedContainerKekStateInTransaction } from "../../../../access/write/containerKekStore";
import type { DatabaseTransaction } from "../../../../adapters/postgres";
import {
  projectionAccessManifestRecord,
  projectionVerifiedAccessEventRecord,
} from "../../../../keyingProjectionRecords";
import {
  containerMetadataDocuments,
  containerSyncTombstones,
  containers,
  documents,
  principalMembershipProjection,
  principalStates,
} from "../../../../schema";
import {
  KeyingReadAccessError,
  resolveReadableContainerAccess,
} from "../../../keyingReadAccess";
import { createContainerWriterProjectionContext } from "../../writerProjection";
import { ContainerMutationError, runConflictBoundary } from "../errors";
import type {
  ContainerMutationContext,
  StoredContainerRow,
  VerifiedContainerAccessState,
} from "../types";
import {
  containerAccessStateRecord,
  referencedPrincipalHeadRecord,
} from "./accessManifestRecords";
import {
  containerKekRecipientTargetRecord,
  containerKeyEpochRecord,
  containerKeyWrapRecord,
} from "./containerKekRecords";

async function loadContainerRow(
  executor: DatabaseTransaction,
  containerId: string,
): Promise<StoredContainerRow | null> {
  const [row] = await executor
    .select({
      depth: containers.depth,
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  return row ?? null;
}

async function assertMetadataDocumentAvailable(
  executor: DatabaseTransaction,
  metadataDocumentId: string,
): Promise<void> {
  const [existingMetadataDocument] = await executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, metadataDocumentId))
    .limit(1);
  if (existingMetadataDocument) {
    throw new ContainerMutationError(
      "Container metadata document already exists",
      409,
    );
  }
}

async function insertContainerMetadataBinding(
  executor: DatabaseTransaction,
  state: VerifiedContainerAccessState,
): Promise<void> {
  const [metadataBinding] = await executor
    .insert(containerMetadataDocuments)
    .values({
      containerId: state.containerId,
      documentId: state.metadataDocumentId,
    })
    .onConflictDoNothing()
    .returning({ containerId: containerMetadataDocuments.containerId });
  if (!metadataBinding) {
    throw new ContainerMutationError(
      "Container metadata binding already exists",
      409,
    );
  }
}

async function persistCreatedContainerStructure(
  executor: DatabaseTransaction,
  state: VerifiedContainerAccessState,
  updatedAt: Date,
): Promise<StoredContainerRow> {
  if (!state.parentContainerId) {
    throw new ContainerMutationError("container create requires a parent", 400);
  }

  const parent = await loadContainerRow(executor, state.parentContainerId);
  if (!parent) {
    throw new ContainerMutationError("Parent container not found", 404);
  }

  if (parent.organizationId !== state.organizationId) {
    throw new ContainerMutationError(
      "Parent container organization mismatch",
      409,
    );
  }

  await assertMetadataDocumentAvailable(executor, state.metadataDocumentId);

  const [inserted] = await executor
    .insert(containers)
    .values({
      depth: parent.depth + 1,
      id: state.containerId,
      organizationId: state.organizationId,
      parentId: state.parentContainerId,
      updatedAt,
    })
    .onConflictDoNothing({ target: containers.id })
    .returning({ id: containers.id });

  if (!inserted) {
    throw new ContainerMutationError("Container already exists", 409);
  }

  await insertContainerMetadataBinding(executor, state);

  return {
    depth: parent.depth + 1,
    id: state.containerId,
    organizationId: state.organizationId,
    parentId: state.parentContainerId,
  };
}

async function touchContainerStructure(
  executor: DatabaseTransaction,
  containerId: string,
  updatedAt: Date,
): Promise<void> {
  await executor
    .update(containers)
    .set({ updatedAt })
    .where(eq(containers.id, containerId));
}

async function persistContainerStructure(
  executor: DatabaseTransaction,
  manifest: VerifiedContainerAccessManifest,
  updatedAt: Date,
): Promise<StoredContainerRow> {
  const state = manifest.state;

  if (manifest.event.event.eventType === "container.create") {
    return persistCreatedContainerStructure(executor, state, updatedAt);
  }

  const container = await loadContainerRow(executor, state.containerId);
  if (!container) {
    throw new ContainerMutationError("Container not found", 404);
  }

  if (container.organizationId !== state.organizationId) {
    throw new ContainerMutationError("Container organization mismatch", 409);
  }

  if (manifest.event.event.eventType !== "container.move") {
    await touchContainerStructure(executor, state.containerId, updatedAt);
    return container;
  }

  if (!container.parentId) {
    throw new ContainerMutationError("Root container cannot be moved", 400);
  }

  if (!state.parentContainerId) {
    throw new ContainerMutationError(
      "Destination parent container is required",
      400,
    );
  }

  const destinationParent = await loadContainerRow(
    executor,
    state.parentContainerId,
  );
  if (!destinationParent) {
    throw new ContainerMutationError(
      "Destination parent container not found",
      404,
    );
  }

  if (destinationParent.organizationId !== state.organizationId) {
    throw new ContainerMutationError(
      "Destination parent organization mismatch",
      409,
    );
  }

  await executor.execute(sql`
    with recursive subtree as (
      select
        ${containers.id} as id,
        ${destinationParent.depth + 1}::int as next_depth
      from ${containers}
      where ${containers.id} = ${state.containerId}::uuid
      union all
      select
        child.id,
        subtree.next_depth + 1
      from ${containers} child
      inner join subtree on child.parent_id = subtree.id
    )
    update ${containers} c
    set
      parent_id = case
        when c.id = ${state.containerId}::uuid then ${state.parentContainerId}::uuid
        else c.parent_id
      end,
      depth = subtree.next_depth,
      updated_at = ${updatedAt}
    from subtree
    where c.id = subtree.id
  `);

  return {
    ...container,
    depth: destinationParent.depth + 1,
    parentId: state.parentContainerId,
  };
}

function directGrantKey(
  grant: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
): string {
  return `${grant.subjectType}:${grant.subjectId}`;
}

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

function referencedPrincipalHeadForGrant(input: {
  readonly grant: ContainerDirectGrant;
  readonly manifest: VerifiedContainerAccessManifest;
}) {
  const { grant, manifest } = input;
  if (grant.subjectType === "user") {
    return null;
  }

  return (
    manifest.state.referencedPrincipalHeads.find(
      (principalHead) =>
        principalHead.principalType === grant.subjectType &&
        principalHead.principalId === grant.subjectId,
    ) ?? null
  );
}

function isManagedGrantUserRow(
  value: unknown,
): value is { readonly userId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "userId") === "string"
  );
}

async function userIdsForManagedGrant(input: {
  readonly executor: DatabaseTransaction;
  readonly grant: ContainerDirectGrant;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<string[]> {
  const referencedPrincipalHead = referencedPrincipalHeadForGrant({
    grant: input.grant,
    manifest: input.manifest,
  });
  if (!referencedPrincipalHead) {
    return [];
  }

  const result = await input.executor.execute(sql`
    with recursive current_principal_states as (
      select distinct on (principal_type, principal_id)
        principal_type,
        principal_id,
        state_hash
      from ${principalStates}
      order by principal_type asc, principal_id asc, version desc
    ),
    reachable_members as (
      select
        ${principalMembershipProjection.memberPrincipalType} as member_principal_type,
        ${principalMembershipProjection.memberPrincipalId} as member_principal_id
      from ${principalMembershipProjection}
      where
        ${principalMembershipProjection.principalType} = ${referencedPrincipalHead.principalType}
        and ${principalMembershipProjection.principalId} = ${referencedPrincipalHead.principalId}
        and ${principalMembershipProjection.stateHash} = ${referencedPrincipalHead.stateHash}
      union
      select
        nested_members.member_principal_type,
        nested_members.member_principal_id
      from reachable_members reachable
      inner join current_principal_states nested_state
        on nested_state.principal_type = reachable.member_principal_type
        and nested_state.principal_id = reachable.member_principal_id
      inner join ${principalMembershipProjection} nested_members
        on nested_members.principal_type = nested_state.principal_type
        and nested_members.principal_id = nested_state.principal_id
        and nested_members.state_hash = nested_state.state_hash
      where reachable.member_principal_type <> ${"user"}
    )
    select distinct member_principal_id as "userId"
    from reachable_members
    where member_principal_type = ${"user"}
  `);
  const userIds: string[] = [];

  for (const row of result.rows) {
    if (!isManagedGrantUserRow(row)) {
      throw new Error("Unexpected row shape from managed grant user query");
    }

    userIds.push(row.userId);
  }

  return userIds;
}

async function userIdsForGrant(input: {
  readonly executor: DatabaseTransaction;
  readonly grant: ContainerDirectGrant;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<string[]> {
  if (input.grant.subjectType === "user") {
    return [input.grant.subjectId];
  }

  return userIdsForManagedGrant(input);
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

async function userIdsWithReadableAccessThroughPath(input: {
  readonly executor: DatabaseTransaction;
  readonly path: readonly VerifiedContainerAccessManifest[];
}): Promise<string[]> {
  const userIds = new Set<string>();

  for (const manifest of input.path) {
    for (const grant of manifest.state.directGrants) {
      for (const userId of await userIdsForGrant({
        executor: input.executor,
        grant,
        manifest,
      })) {
        userIds.add(userId);
      }
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
      set: rowUpdates,
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
      set: rowUpdates,
    });
}

export async function persistVerifiedMutation(
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest,
  kekState: VerifiedContainerKekState,
  previousManifest: VerifiedContainerAccessManifest | null,
  previousContainerPath?: readonly VerifiedContainerAccessManifest[],
): Promise<ContainerMutationResponse> {
  const { executor } = context;
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
    throw new ContainerMutationError("Container manifest head is stale", 409);
  }
  context.manifestHeadByContainerId.set(
    manifest.state.containerId,
    manifestHead,
  );
  await persistAccessRevocationTombstones({
    container,
    executor,
    manifest,
    previousManifest,
    updatedAt,
  });
  if (previousContainerPath) {
    await persistMoveAccessLossTombstones({
      executor,
      manifest,
      previousContainerPath,
      previousManifest,
      updatedAt,
    });
  }

  const storedKekState = await runConflictBoundary(() =>
    storeVerifiedContainerKekStateInTransaction(
      { verifiedState: kekState },
      executor,
    ),
  );

  return {
    containerId: manifest.state.containerId,
    organizationId: manifest.state.organizationId,
    parentId: manifest.state.parentContainerId,
    manifestHead: {
      epoch: manifestHead.epoch,
      manifestHash: manifestHead.manifestHash,
    },
    accessManifest: {
      event: projectionVerifiedAccessEventRecord(manifest.event),
      manifest: projectionAccessManifestRecord(manifest.manifest),
      manifestHash: manifest.manifestHash,
      state: containerAccessStateRecord(manifest.state),
    },
    containerKek: {
      containerId: storedKekState.containerId,
      accessManifestHash: storedKekState.accessManifestHash,
      containerKeyEpochId: storedKekState.containerKeyEpochId,
      containerKeyEpoch: storedKekState.containerKeyEpoch,
      keyEpoch: containerKeyEpochRecord(storedKekState.keyEpoch),
      keyEpochHash: storedKekState.keyEpochHash,
      keyTargetHash: storedKekState.keyTargetHash,
      parentContainerKeyEpochId: storedKekState.parentContainerKeyEpochId,
      recipientTargets: storedKekState.recipientTargets.map(
        containerKekRecipientTargetRecord,
      ),
      wraps: storedKekState.wraps.map(containerKeyWrapRecord),
    },
    referencedPrincipalHeads: manifest.manifest.referencedPrincipalHeads.map(
      referencedPrincipalHeadRecord,
    ),
  };
}
