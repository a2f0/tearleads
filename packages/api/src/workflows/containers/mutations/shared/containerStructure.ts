import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { eq, sql } from "drizzle-orm";
import {
  intExpression,
  timestampValue,
  uuidValue,
} from "../../../../utils/sqlDialect";
import {
  ContainerMutationError,
  containerManifestAlreadyExists,
  runConflictBoundary,
} from "../errors";
import type {
  StoredContainerRow,
  VerifiedContainerAccessState,
} from "../types";
import {
  assertContainerDepth,
  assertContainerMoveDepth,
} from "./containerDepth";
import {
  assertMetadataDocumentAvailable,
  insertContainerMetadataBinding,
} from "./metadataDocumentReservation";

async function loadContainerRow(
  executor: DatabaseTransaction,
  containerId: string,
): Promise<StoredContainerRow | null> {
  const [row] = await executor
    .select({
      createdAt: containers.createdAt,
      systemSlot: containers.systemSlot,
      depth: containers.depth,
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
      updatedAt: containers.updatedAt,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  return row ?? null;
}

async function persistCreatedContainerStructure(
  executor: DatabaseTransaction,
  state: VerifiedContainerAccessState,
  updatedAt: Date,
): Promise<StoredContainerRow> {
  const isMetadataRoot =
    state.parentContainerId === null &&
    state.systemSlot ===
      (await deriveOrganizationMetadataContainerSystemSlot({
        organizationId: state.organizationId,
      }));
  if (state.parentContainerId === null && !isMetadataRoot)
    throw new ContainerMutationError("container create requires a parent", 400);
  const parent = state.parentContainerId
    ? await loadContainerRow(executor, state.parentContainerId)
    : null;
  if (!parent && !isMetadataRoot) {
    throw new ContainerMutationError("Parent container not found", 404);
  }

  if (parent && parent.organizationId !== state.organizationId) {
    throw new ContainerMutationError(
      "Parent container organization mismatch",
      409,
    );
  }

  assertContainerDepth(parent ? parent.depth + 1 : 0);
  await assertMetadataDocumentAvailable(executor, state.metadataDocumentId);

  const [inserted] = await runConflictBoundary(() =>
    executor
      .insert(containers)
      .values({
        depth: parent ? parent.depth + 1 : 0,
        systemSlot: state.systemSlot,
        id: state.containerId,
        organizationId: state.organizationId,
        parentId: state.parentContainerId,
        updatedAt,
      })
      .onConflictDoNothing({ target: containers.id })
      .returning({
        createdAt: containers.createdAt,
        systemSlot: containers.systemSlot,
        depth: containers.depth,
        id: containers.id,
        organizationId: containers.organizationId,
        parentId: containers.parentId,
        updatedAt: containers.updatedAt,
      }),
  );

  if (!inserted) {
    throw containerManifestAlreadyExists();
  }

  await insertContainerMetadataBinding(executor, state);
  return {
    createdAt: inserted.createdAt,
    systemSlot: inserted.systemSlot,
    depth: inserted.depth,
    id: inserted.id,
    organizationId: inserted.organizationId,
    parentId: inserted.parentId,
    updatedAt: inserted.updatedAt,
  };
}

async function touchContainerStructure(
  executor: DatabaseTransaction,
  containerId: string,
  updatedAt: Date,
): Promise<StoredContainerRow> {
  const [updated] = await executor
    .update(containers)
    .set({ updatedAt })
    .where(eq(containers.id, containerId))
    .returning({
      createdAt: containers.createdAt,
      systemSlot: containers.systemSlot,
      depth: containers.depth,
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
      updatedAt: containers.updatedAt,
    });
  if (!updated) {
    throw new ContainerMutationError("Container not found", 404);
  }

  return updated;
}

export async function persistContainerStructure(
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
    return touchContainerStructure(executor, state.containerId, updatedAt);
  }

  if (!container.parentId) {
    throw new ContainerMutationError("Root container cannot be moved", 400);
  }
  if (container.systemSlot !== null) {
    throw new ContainerMutationError("System container cannot be moved", 400);
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

  await assertContainerMoveDepth(
    executor,
    state.containerId,
    destinationParent.depth,
  );

  await executor.execute(sql`
    with recursive subtree as (
      select
        ${containers.id} as id,
        ${intExpression(sql`${destinationParent.depth + 1}`)} as next_depth
      from ${containers}
      where ${containers.id} = ${uuidValue(state.containerId)}
      union all
      select
        child.id,
        subtree.next_depth + 1
      from ${containers} child
      inner join subtree on child.parent_id = subtree.id
    )
    update ${containers}
    set
      parent_id = case
        when ${containers.id} = ${uuidValue(state.containerId)} then ${uuidValue(state.parentContainerId)}
        else ${containers.parentId}
      end,
      depth = (
        select subtree.next_depth
        from subtree
        where subtree.id = ${containers.id}
      ),
      updated_at = ${timestampValue(updatedAt)}
    where ${containers.id} in (select id from subtree)
  `);

  return {
    ...container,
    depth: destinationParent.depth + 1,
    parentId: state.parentContainerId,
    updatedAt,
  };
}
