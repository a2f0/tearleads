import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  containerMetadataDocuments,
  containers,
} from "@tearleads/api-shared/schema";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { and, eq, isNull } from "drizzle-orm";

/**
 * The organization profile pointer is an unsigned selector, so it may name only
 * a document whose current head links it to exactly the organization metadata
 * system container, where provisioning and the org-manager editor create it.
 * Only admins write there; any other organization document would let its
 * writers spoof the organization's display name. The container's own metadata
 * document is refused too.
 */
export async function isOrganizationProfileDocument(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly profileDocumentId: string;
}): Promise<boolean> {
  const metadataSystemSlot =
    await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: input.organizationId,
    });
  const links = await input.executor
    .select({
      organizationId: containers.organizationId,
      systemSlot: containers.systemSlot,
    })
    .from(accessManifestHeads)
    .innerJoin(
      accessManifestDocumentLinkProjection,
      and(
        eq(
          accessManifestDocumentLinkProjection.documentId,
          accessManifestHeads.objectId,
        ),
        eq(
          accessManifestDocumentLinkProjection.manifestHash,
          accessManifestHeads.manifestHash,
        ),
      ),
    )
    .innerJoin(
      containers,
      eq(containers.id, accessManifestDocumentLinkProjection.containerId),
    )
    .leftJoin(
      containerMetadataDocuments,
      eq(containerMetadataDocuments.documentId, accessManifestHeads.objectId),
    )
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.objectId, input.profileDocumentId),
        eq(accessManifestHeads.organizationId, input.organizationId),
        isNull(containerMetadataDocuments.documentId),
      ),
    );

  return (
    links.length === 1 &&
    links[0]?.organizationId === input.organizationId &&
    links[0].systemSlot === metadataSystemSlot
  );
}
