import type { MoveContainerRequest } from "@tearleads/validators/request";
import type { MoveContainerResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  ContainerCryptoRecipientResolutionError,
  canAdminContainerAccess,
  canWriteContainerAccess,
  listDescendantContainers,
  refreshContainerAccessSubtree,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import {
  listRecipientEncapsulationPublicKeys,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import type { DatabaseTransaction } from "../../adapters/postgres";
import { containerMetadataDocuments, containers } from "../../schema";
import type { ApiServiceRuntime } from "../runtime";
import { refreshAccessForLinkedContainers } from "../structural/shared";

interface MoveContainerInput extends MoveContainerRequest {
  containerId: string;
  userId: string;
}

export class MoveContainerError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

async function moveContainerInTransaction(
  tx: DatabaseTransaction,
  input: MoveContainerInput,
): Promise<MoveContainerResponse> {
  const [container] = await tx
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, input.containerId))
    .limit(1);

  if (!container) {
    throw new MoveContainerError("Container not found", 404);
  }

  const [parent] = await tx
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(eq(containers.id, input.parentId))
    .limit(1);

  if (!parent) {
    throw new MoveContainerError("Parent container not found", 404);
  }

  if (container.parentId === null) {
    throw new MoveContainerError("Root containers cannot be moved", 409);
  }

  if (container.organizationId !== parent.organizationId) {
    throw new MoveContainerError(
      "Container and parent must belong to the same organization",
      400,
    );
  }

  const containerAccess = await resolveContainerAccessState(container.id, tx);
  if (!containerAccess) {
    throw new MoveContainerError("Container access state is unavailable", 409);
  }

  if (!canAdminContainerAccess(containerAccess, input.userId)) {
    throw new MoveContainerError("Forbidden", 403);
  }

  const parentAccess = await resolveContainerAccessState(parent.id, tx);
  if (!parentAccess) {
    throw new MoveContainerError(
      "Parent container access state is unavailable",
      409,
    );
  }

  if (!canWriteContainerAccess(parentAccess, input.userId)) {
    throw new MoveContainerError("Forbidden", 403);
  }

  if (container.parentId === parent.id) {
    return buildMoveContainerResponse(tx, container.id, parent.id);
  }

  const descendantContainers = await listDescendantContainers(container.id, tx);
  const descendantContainerIds = descendantContainers.map(
    (descendantContainer) => descendantContainer.id,
  );

  if (descendantContainerIds.includes(parent.id)) {
    throw new MoveContainerError(
      "Container cannot be moved under its descendant",
      400,
    );
  }

  await tx
    .update(containers)
    .set({ parentId: parent.id })
    .where(eq(containers.id, container.id));

  const refreshedEpochs = await refreshContainerAccessSubtree(
    container.id,
    tx,
    {
      descendantContainers,
    },
  );
  await refreshAccessForLinkedContainers(
    Array.from(refreshedEpochs.keys()),
    tx,
  );

  return buildMoveContainerResponse(tx, container.id, parent.id);
}

export async function moveContainer(
  runtime: ApiServiceRuntime,
  input: MoveContainerInput,
): Promise<MoveContainerResponse> {
  try {
    return await runtime.db.transaction((tx) =>
      moveContainerInTransaction(tx, input),
    );
  } catch (error) {
    if (error instanceof ContainerCryptoRecipientResolutionError) {
      throw new MoveContainerError(error.message, 409);
    }

    throw error;
  }
}

async function buildMoveContainerResponse(
  tx: DatabaseTransaction,
  containerId: string,
  parentId: string,
): Promise<MoveContainerResponse> {
  const [container] = await tx
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  if (!container) {
    throw new MoveContainerError("Container not found", 404);
  }

  const [metadataBinding] = await tx
    .select({
      documentId: containerMetadataDocuments.documentId,
    })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, containerId))
    .limit(1);

  if (!metadataBinding) {
    throw new MoveContainerError("Container metadata document not found", 409);
  }

  const metadataAccess = await resolveDocumentAccessState(
    metadataBinding.documentId,
    tx,
  );

  if (!metadataAccess) {
    throw new MoveContainerError(
      "Container metadata access state is unavailable",
      409,
    );
  }

  return {
    id: container.id,
    organizationId: container.organizationId,
    parentId: container.parentId ?? parentId,
    metadataDocumentId: metadataBinding.documentId,
    metadataAccessEpoch: metadataAccess.currentAccessEpoch,
    metadataRecipientEncapsulationPublicKeys:
      listRecipientEncapsulationPublicKeys(metadataAccess),
    metadataReferencedPrincipals: metadataAccess.referencedPrincipals,
  };
}
