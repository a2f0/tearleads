import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import {
  containerSyncTombstones,
  containers,
  documentContainerLinks,
} from "@symcrypt/api-shared/schema";
import type { ContainerDeleteResponse } from "@symcrypt/validators/response";
import { and, eq, ne, sql } from "drizzle-orm";
import { lockAccessManifestHeadsForUpdate } from "../../access/read/accessManifestStore";
import { uniqueSortedStrings } from "../../utils/array";
import { uuidValue } from "../../utils/sqlDialect";
import { assertOrganizationCanSync } from "../billing/organizationSyncEligibility";
import { teardownContainerMetadataDocument } from "../documents/mutations/purgeDocument";
import {
  appendOrganizationReadModelChangeInTransaction,
  lockOrganizationReadModelHeadForUpdateInTransaction,
} from "../organizations/readModelChanges";
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
  const userIds = uniqueSortedStrings(input.userIds);
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
  readonly metadataDocumentId: string;
}): Promise<void> {
  // A container's OWN metadata document is always linked to it, so it must be
  // excluded from the "no linked documents" guard — otherwise no folder could
  // ever be deleted. The guard still blocks deletion when any OTHER (user)
  // document is linked, or the container has children. The metadata document is
  // torn down separately once the container row is gone.
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
            and link.document_id <> ${uuidValue(input.metadataDocumentId)}
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
    .where(
      and(
        eq(documentContainerLinks.containerId, input.containerId),
        ne(documentContainerLinks.documentId, input.metadataDocumentId),
      ),
    )
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
  const resolveAccess = async () => {
    const context = createContainerWriterProjectionContext(input.executor);
    try {
      return await resolveContainerAccessProjection({
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
  };

  const initialAccess = await resolveAccess();
  const initialTargetManifest = initialAccess.verifiedPath.at(-1);
  if (!initialTargetManifest) {
    throw new DeleteContainerError("Container not found", 404);
  }
  const organizationId = initialTargetManifest.state.organizationId;
  const headLocked = await lockOrganizationReadModelHeadForUpdateInTransaction(
    input.executor,
    organizationId,
  );
  if (!headLocked) {
    throw new Error("Organization read-model cursor head is missing");
  }

  // Rebuild the writer projection after serializing the organization so a
  // concurrent revocation cannot race the delete authorization.
  const access = await resolveAccess();
  const targetManifest = access.verifiedPath.at(-1);
  if (!targetManifest) {
    throw new DeleteContainerError("Container not found", 404);
  }
  if (targetManifest.state.organizationId !== organizationId) {
    throw new DeleteContainerError("Container organization mismatch", 409);
  }

  const container = await loadContainerForDelete(input);
  if (container.organizationId !== organizationId) {
    throw new DeleteContainerError("Container organization mismatch", 409);
  }
  const updatedAt = new Date();
  const visibleUserIds = await userIdsByContainerPath({
    executor: input.executor,
    path: access.verifiedPath,
  });
  await assertOrganizationCanSync(input.executor, organizationId, input.userId);
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
  // Lock the metadata document's manifest head BEFORE touching the container
  // row. A concurrent sync write holds the head FOR UPDATE and later
  // updates the linked container row; locking the container row first (via its
  // delete) and the head second would wait on that sync while it waits on the
  // row — a deadlock. Head-then-row here matches the sync path's order.
  await lockAccessManifestHeadsForUpdate(
    "document",
    [targetManifest.state.metadataDocumentId],
    input.executor,
  );
  // deleteLeafContainerRow throws on a non-empty container (child or other
  // linked document), so the teardown below only runs once the container is
  // genuinely gone; the whole delete is one transaction, so a thrown 409 rolls
  // back cleanly. There is no FK from the metadata document's rows to the
  // container, so deleting the container row first is referentially safe.
  await deleteLeafContainerRow({
    containerId: input.containerId,
    executor: input.executor,
    metadataDocumentId: targetManifest.state.metadataDocumentId,
  });
  await teardownContainerMetadataDocument({
    containerId: input.containerId,
    documentId: targetManifest.state.metadataDocumentId,
    executor: input.executor,
  });
  await appendOrganizationReadModelChangeInTransaction(input.executor, {
    organizationId,
    lane: "grants",
    entityId: organizationId,
    operation: "replace",
  });

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
