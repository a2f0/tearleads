import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  containerSyncTombstones,
  containers,
  documentContainerLinks,
} from "@tearleads/api-shared/schema";
import type { ContainerDeleteResponse } from "@tearleads/validators/response";
import { and, eq, sql } from "drizzle-orm";
import { uuidValue } from "../../utils/sqlDialect";
import { assertOrganizationCanSync } from "../billing/organizationBilling";
import { userIdsByContainerPath } from "./containerPathUsers";
import {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerAccessProjection,
} from "./writerProjection";

type DeleteContainerStatus = 400 | 403 | 404 | 409;

export class DeleteContainerError extends Error {
  constructor(
    message: string,
    readonly status: DeleteContainerStatus,
  ) {
    super(message);
    this.name = "DeleteContainerError";
  }
}

interface StoredContainerRow {
  readonly systemSlot: string | null;
  readonly depth: number;
  readonly id: string;
  readonly organizationId: string;
  readonly parentId: string | null;
}

function toDeleteContainerError(
  error: ContainerWriterProjectionError,
): DeleteContainerError {
  return new DeleteContainerError(error.message, error.status);
}

async function loadContainerForDelete(input: {
  readonly containerId: string;
  readonly executor: DatabaseTransaction;
}): Promise<StoredContainerRow> {
  const [container] = await input.executor
    .select({
      systemSlot: containers.systemSlot,
      depth: containers.depth,
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, input.containerId))
    .limit(1);

  if (!container) {
    throw new DeleteContainerError("Container not found", 404);
  }
  if (container.parentId === null) {
    throw new DeleteContainerError("Root container cannot be deleted", 400);
  }
  if (container.systemSlot !== null) {
    throw new DeleteContainerError("System container cannot be deleted", 400);
  }

  return container;
}

async function persistDeletedContainerTombstones(input: {
  readonly container: StoredContainerRow;
  readonly executor: DatabaseTransaction;
  readonly rootDiscoveryUserIds: ReadonlySet<string>;
  readonly updatedAt: Date;
  readonly userIds: readonly string[];
}): Promise<void> {
  const userIds = [...new Set(input.userIds)].sort();
  if (userIds.length === 0) {
    return;
  }

  const rowUpdates = {
    depth: input.container.depth,
    organizationId: input.container.organizationId,
    parentId: input.container.parentId,
    reason: "deleted" as const,
    updatedAt: input.updatedAt,
  };

  await input.executor
    .insert(containerSyncTombstones)
    .values(
      userIds.map((userId) => ({
        ...rowUpdates,
        containerId: input.container.id,
        rootDiscoveryVisible: input.rootDiscoveryUserIds.has(userId),
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

async function deleteLeafContainerRow(input: {
  readonly containerId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  const [deleted] = await input.executor
    .delete(containers)
    .where(
      and(
        eq(containers.id, input.containerId),
        sql`not exists (
          select 1
          from ${containers} child
          where child.parent_id = ${uuidValue(input.containerId)}
        )`,
        sql`not exists (
          select 1
          from ${documentContainerLinks} link
          where link.container_id = ${uuidValue(input.containerId)}
        )`,
      ),
    )
    .returning({ id: containers.id });

  if (deleted) {
    return;
  }

  const [child] = await input.executor
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.parentId, input.containerId))
    .limit(1);

  if (child) {
    throw new DeleteContainerError("Container has child containers", 409);
  }

  const [linkedDocument] = await input.executor
    .select({ documentId: documentContainerLinks.documentId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.containerId, input.containerId))
    .limit(1);

  if (linkedDocument) {
    throw new DeleteContainerError("Container has linked documents", 409);
  }

  throw new DeleteContainerError("Container not found", 404);
}

async function deleteContainerWithExecutor(input: {
  readonly containerId: string;
  readonly executor: DatabaseTransaction;
  readonly userId: string;
}): Promise<ContainerDeleteResponse> {
  const context = createContainerWriterProjectionContext(input.executor);
  let access: Awaited<ReturnType<typeof resolveContainerAccessProjection>>;

  try {
    access = await resolveContainerAccessProjection({
      containerId: input.containerId,
      context,
      executor: input.executor,
      minimumAccessLevel: "admin",
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof ContainerWriterProjectionError) {
      throw toDeleteContainerError(error);
    }
    throw error;
  }

  const container = await loadContainerForDelete(input);
  const updatedAt = new Date();
  const visibleUserIds = await userIdsByContainerPath({
    executor: input.executor,
    path: access.verifiedPath,
  });
  const targetManifest = access.verifiedPath.at(-1);
  if (!targetManifest) {
    throw new DeleteContainerError("Container not found", 404);
  }
  await assertOrganizationCanSync(
    input.executor,
    targetManifest.state.organizationId,
  );
  const rootDiscoveryUserIds = new Set(
    visibleUserIds.userIdsByContainerId.get(targetManifest.state.containerId) ??
      [],
  );

  await persistDeletedContainerTombstones({
    container,
    executor: input.executor,
    rootDiscoveryUserIds,
    updatedAt,
    userIds: [...visibleUserIds.allUserIds, input.userId],
  });
  await deleteLeafContainerRow(input);

  return {
    containerId: input.containerId,
    deletedAt: updatedAt.toISOString(),
  };
}

export async function deleteContainer(
  db: ApiDatabase,
  input: {
    readonly containerId: string;
    readonly userId: string;
  },
): Promise<ContainerDeleteResponse> {
  return db.transaction((tx) =>
    deleteContainerWithExecutor({
      ...input,
      executor: tx,
    }),
  );
}
