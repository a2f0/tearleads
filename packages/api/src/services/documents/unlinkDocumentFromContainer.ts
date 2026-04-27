import type { LinkDocumentToContainerRequest } from "@tearleads/validators/request";
import type { UnlinkDocumentFromContainerResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { refreshDocumentAccesses } from "../../access/documentAccess";
import { documentContainerLinks } from "../../schema";
import type { ApiServiceRuntime } from "../runtime";
import {
  buildDocumentMutationResponse,
  requireMutableDocumentContext,
  requireWritableContainer,
  StructuralDocumentMutationError,
} from "./shared";

interface UnlinkDocumentFromContainerInput
  extends LinkDocumentToContainerRequest {
  documentId: string;
  userId: string;
}

export async function unlinkDocumentFromContainer(
  runtime: ApiServiceRuntime,
  input: UnlinkDocumentFromContainerInput,
): Promise<UnlinkDocumentFromContainerResponse> {
  return runtime.db.transaction(async (tx) => {
    const documentContext = await requireMutableDocumentContext(
      tx,
      input.documentId,
      input.userId,
    );

    if (input.expectedAccessStateHash !== documentContext.accessStateHash) {
      throw new StructuralDocumentMutationError("Stale access state hash", 409);
    }

    await requireWritableContainer(tx, input.containerId, input.userId);

    if (!documentContext.linkedContainerIds.includes(input.containerId)) {
      throw new StructuralDocumentMutationError("Document link not found", 404);
    }

    if (documentContext.linkedContainerIds.length === 1) {
      throw new StructuralDocumentMutationError(
        "Document must remain linked to at least one container",
        409,
      );
    }

    await tx
      .delete(documentContainerLinks)
      .where(
        and(
          eq(documentContainerLinks.documentId, input.documentId),
          eq(documentContainerLinks.containerId, input.containerId),
        ),
      );

    await refreshDocumentAccesses([input.documentId], tx);

    return buildDocumentMutationResponse(
      tx,
      input.documentId,
      documentContext.linkedContainerIds.filter(
        (containerId) => containerId !== input.containerId,
      ),
    );
  });
}
