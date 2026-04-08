import type { LinkDocumentToContainerRequest } from "@tearleads/validators/request";
import type { LinkDocumentToContainerResponse } from "@tearleads/validators/response";
import { documentContainerLinks } from "../../schema";
import type { ApiServiceRuntime } from "../runtime";
import { refreshLinkedDocumentAndBlobAccess } from "../structural/shared";
import {
  buildDocumentMutationResponse,
  requireMutableDocumentContext,
  requireWritableContainer,
  StructuralDocumentMutationError,
} from "./shared";

interface LinkDocumentToContainerInput extends LinkDocumentToContainerRequest {
  documentId: string;
  userId: string;
}

export async function linkDocumentToContainer(
  runtime: ApiServiceRuntime,
  input: LinkDocumentToContainerInput,
): Promise<LinkDocumentToContainerResponse> {
  return runtime.db.transaction(async (tx) => {
    const documentContext = await requireMutableDocumentContext(
      tx,
      input.documentId,
      input.userId,
    );
    const targetContainer = await requireWritableContainer(
      tx,
      input.containerId,
      input.userId,
    );

    if (documentContext.organizationId !== targetContainer.organizationId) {
      throw new StructuralDocumentMutationError(
        "Document and container must belong to the same organization",
        400,
      );
    }

    if (documentContext.linkedContainerIds.includes(input.containerId)) {
      throw new StructuralDocumentMutationError(
        "Document is already linked to the container",
        409,
      );
    }

    await tx.insert(documentContainerLinks).values({
      documentId: input.documentId,
      containerId: input.containerId,
    });

    await refreshLinkedDocumentAndBlobAccess([input.documentId], tx);

    return buildDocumentMutationResponse(tx, input.documentId, [
      ...documentContext.linkedContainerIds,
      input.containerId,
    ]);
  });
}
