import type { ContainerDocumentSummary } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  canWriteContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import {
  listRecipientEncapsulationPublicKeys,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import type { DatabaseTransaction } from "../../adapters/postgres";
import {
  containerMetadataDocuments,
  containers,
  documentContainerLinks,
  documents,
} from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";

export class StructuralDocumentMutationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export async function requireMutableDocumentContext(
  tx: DatabaseTransaction,
  documentId: string,
  userId: string,
): Promise<{
  createdAt: Date;
  linkedContainerIds: string[];
  organizationId: string;
}> {
  const [document] = await tx
    .select({
      createdAt: documents.createdAt,
      id: documents.id,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!document) {
    throw new StructuralDocumentMutationError("Document not found", 404);
  }

  const [metadataBinding] = await tx
    .select({ documentId: containerMetadataDocuments.documentId })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.documentId, documentId))
    .limit(1);

  if (metadataBinding) {
    throw new StructuralDocumentMutationError(
      "Container metadata documents cannot be structurally relinked",
      409,
    );
  }

  const linkedContainerRows = await tx
    .select({
      containerId: documentContainerLinks.containerId,
      organizationId: containers.organizationId,
    })
    .from(documentContainerLinks)
    .innerJoin(
      containers,
      eq(containers.id, documentContainerLinks.containerId),
    )
    .where(eq(documentContainerLinks.documentId, documentId));

  const linkedContainerIds = uniqueSortedStrings(
    linkedContainerRows.map((row) => row.containerId),
  );

  if (linkedContainerIds.length === 0) {
    throw new StructuralDocumentMutationError(
      "Document has no linked containers",
      409,
    );
  }

  const organizationIds = uniqueSortedStrings(
    linkedContainerRows.map((row) => row.organizationId),
  );

  if (organizationIds.length !== 1) {
    throw new StructuralDocumentMutationError(
      "All linked containers must belong to the same organization",
      409,
    );
  }

  for (const containerId of linkedContainerIds) {
    const access = await resolveContainerAccessState(containerId, tx);

    if (!access) {
      throw new StructuralDocumentMutationError(
        "Linked container access state is unavailable",
        409,
      );
    }

    if (!canWriteContainerAccess(access, userId)) {
      throw new StructuralDocumentMutationError("Forbidden", 403);
    }
  }

  return {
    createdAt: document.createdAt,
    linkedContainerIds,
    organizationId: organizationIds[0] ?? "",
  };
}

export async function requireWritableContainer(
  tx: DatabaseTransaction,
  containerId: string,
  userId: string,
): Promise<{ organizationId: string }> {
  const [container] = await tx
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  if (!container) {
    throw new StructuralDocumentMutationError("Container not found", 404);
  }

  const access = await resolveContainerAccessState(container.id, tx);
  if (!access) {
    throw new StructuralDocumentMutationError(
      "Container access state is unavailable",
      409,
    );
  }

  if (!canWriteContainerAccess(access, userId)) {
    throw new StructuralDocumentMutationError("Forbidden", 403);
  }

  return {
    organizationId: container.organizationId,
  };
}

export async function buildDocumentMutationResponse(
  tx: DatabaseTransaction,
  documentId: string,
): Promise<ContainerDocumentSummary> {
  const [document] = await tx
    .select({
      createdAt: documents.createdAt,
      id: documents.id,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!document) {
    throw new StructuralDocumentMutationError("Document not found", 404);
  }

  const access = await resolveDocumentAccessState(documentId, tx);
  if (!access) {
    throw new StructuralDocumentMutationError(
      "Document access state is unavailable",
      409,
    );
  }

  const linkedContainerRows = await tx
    .select({
      containerId: documentContainerLinks.containerId,
    })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, documentId));

  return {
    createdAt: document.createdAt.toISOString(),
    currentAccessEpoch: access.currentAccessEpoch,
    id: document.id,
    linkedContainerIds: uniqueSortedStrings(
      linkedContainerRows.map((row) => row.containerId),
    ),
    recipientEncapsulationPublicKeys:
      listRecipientEncapsulationPublicKeys(access),
    referencedPrincipals: access.referencedPrincipals,
  };
}

export async function documentLinkExists(
  tx: DatabaseTransaction,
  documentId: string,
  containerId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: documentContainerLinks.id })
    .from(documentContainerLinks)
    .where(
      and(
        eq(documentContainerLinks.documentId, documentId),
        eq(documentContainerLinks.containerId, containerId),
      ),
    )
    .limit(1);

  return !!row;
}
