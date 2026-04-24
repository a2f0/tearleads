import type { ShareContainerRequest } from "@tearleads/validators/request";
import type { ShareContainerResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  ContainerCryptoRecipientResolutionError,
  canAdminContainerAccess,
  grantContainerAccess,
  listDescendantContainerIds,
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

interface ShareContainerInput extends ShareContainerRequest {
  containerId: string;
  userId: string;
}

export class ShareContainerError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

async function resolveMetadataAccessForCurrentContainerState(
  tx: DatabaseTransaction,
  metadataDocumentId: string,
  containerId: string,
  containerAccess: NonNullable<
    Awaited<ReturnType<typeof resolveContainerAccessState>>
  >,
) {
  const metadataAccess = await resolveDocumentAccessState(
    metadataDocumentId,
    tx,
    {
      linkedContainerIds: [containerId],
      linkedContainerStateById: new Map([[containerId, containerAccess]]),
    },
  );

  if (!metadataAccess) {
    throw new ShareContainerError(
      "Container metadata access state is unavailable",
      409,
    );
  }

  return metadataAccess;
}

export async function shareContainer(
  runtime: ApiServiceRuntime,
  input: ShareContainerInput,
): Promise<ShareContainerResponse> {
  try {
    return await runtime.db.transaction(async (tx) => {
      const [container] = await tx
        .select({ id: containers.id })
        .from(containers)
        .where(eq(containers.id, input.containerId))
        .limit(1);

      if (!container) {
        throw new ShareContainerError("Container not found", 404);
      }

      const containerAccess = await resolveContainerAccessState(
        input.containerId,
        tx,
      );

      if (!containerAccess) {
        throw new ShareContainerError(
          "Container access state is unavailable",
          409,
        );
      }

      if (!canAdminContainerAccess(containerAccess, input.userId)) {
        throw new ShareContainerError("Forbidden", 403);
      }

      const [metadataBinding] = await tx
        .select({ documentId: containerMetadataDocuments.documentId })
        .from(containerMetadataDocuments)
        .where(eq(containerMetadataDocuments.containerId, input.containerId))
        .limit(1);

      if (!metadataBinding) {
        throw new ShareContainerError(
          "Container metadata document not found",
          409,
        );
      }

      const previousMetadataAccess =
        await resolveMetadataAccessForCurrentContainerState(
          tx,
          metadataBinding.documentId,
          input.containerId,
          containerAccess,
        );

      if (
        input.expectedAccessStateHash !== previousMetadataAccess.accessStateHash
      ) {
        throw new ShareContainerError("Stale access state hash", 409);
      }

      await grantContainerAccess(
        {
          accessLevel: input.accessLevel,
          containerId: input.containerId,
          subjectId: input.subjectId,
          subjectType: input.subjectType,
        },
        tx,
      );

      await refreshAccessForLinkedContainers(
        await listDescendantContainerIds(input.containerId, tx),
        tx,
      );

      const metadataAccess = await resolveDocumentAccessState(
        metadataBinding.documentId,
        tx,
      );

      if (!metadataAccess) {
        throw new ShareContainerError(
          "Container metadata access state is unavailable",
          409,
        );
      }

      return {
        id: input.containerId,
        metadataDocumentId: metadataBinding.documentId,
        metadataAccessEpoch: metadataAccess.currentAccessEpoch,
        metadataAccessStateHash: metadataAccess.accessStateHash,
        metadataRecipientEncapsulationPublicKeys:
          listRecipientEncapsulationPublicKeys(metadataAccess),
        metadataReferencedPrincipals: metadataAccess.referencedPrincipals,
      };
    });
  } catch (error) {
    if (error instanceof ContainerCryptoRecipientResolutionError) {
      throw new ShareContainerError(error.message, 409);
    }

    throw error;
  }
}
