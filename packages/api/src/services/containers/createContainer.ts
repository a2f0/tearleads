import type { CreateContainerRequest } from "@tearleads/validators/request";
import type { CreateContainerResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  canWriteContainerAccess,
  initializeContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import {
  ContainerMetadataError,
  createContainerMetadataDocument,
} from "../../routes/containers/containerMetadata";
import { containers } from "../../schema";
import type { ApiServiceRuntime } from "../runtime";

interface CreateContainerInput extends CreateContainerRequest {
  createdByFingerprint: string;
  userId: string;
}

export class CreateContainerError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export async function createContainer(
  runtime: ApiServiceRuntime,
  input: CreateContainerInput,
): Promise<CreateContainerResponse> {
  return runtime.db.transaction(async (tx) => {
    const [parent] = await tx
      .select({
        id: containers.id,
        organizationId: containers.organizationId,
      })
      .from(containers)
      .where(eq(containers.id, input.parentId))
      .limit(1);

    if (!parent) {
      throw new CreateContainerError("Parent container not found", 404);
    }

    const parentAccess = await resolveContainerAccessState(parent.id, tx);
    if (!parentAccess) {
      throw new CreateContainerError(
        "Parent container access is unavailable",
        409,
      );
    }

    if (!canWriteContainerAccess(parentAccess, input.userId)) {
      throw new CreateContainerError("Forbidden", 403);
    }

    const [container] = await tx
      .insert(containers)
      .values({
        id: input.id,
        organizationId: parent.organizationId,
        parentId: parent.id,
      })
      .onConflictDoNothing({ target: containers.id })
      .returning({
        id: containers.id,
        organizationId: containers.organizationId,
        parentId: containers.parentId,
      });

    if (!container) {
      throw new CreateContainerError("Container already exists", 409);
    }

    await initializeContainerAccess(container.id, tx, {
      inheritedFrom: parentAccess,
    });

    const metadata = await createContainerMetadataDocument(tx, {
      authorFingerprint: input.createdByFingerprint,
      containerId: container.id,
      createdByFingerprint: input.createdByFingerprint,
      initialMetadataUpdates: input.initialMetadataUpdates,
      ...(input.initialMetadataRecipientEnvelopes
        ? {
            initialMetadataRecipientEnvelopes:
              input.initialMetadataRecipientEnvelopes,
          }
        : {}),
    });

    return {
      id: container.id,
      organizationId: container.organizationId,
      parentId: container.parentId ?? parent.id,
      metadataAccessEpoch: metadata.metadataAccessEpoch,
      metadataDocumentId: metadata.metadataDocumentId,
      metadataRecipientEncapsulationPublicKeys:
        metadata.metadataRecipientEncapsulationPublicKeys,
      metadataReferencedPrincipals: metadata.metadataReferencedPrincipals,
    };
  });
}

export { ContainerMetadataError };
