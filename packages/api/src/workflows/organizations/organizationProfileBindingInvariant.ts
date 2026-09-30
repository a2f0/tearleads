import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { containers, organizations } from "@tearleads/api-shared/schema";
import type { VerifiedDocumentLinkSetManifest } from "@tearleads/crypto";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { and, eq } from "drizzle-orm";
import { DocumentMutationError } from "../documents/mutations/errors";

/**
 * Directory read-model deltas carry the organization profile pointer only when
 * the pointer itself changes. A bound profile document therefore keeps the
 * shape the pointer was validated against: it stays solely in the organization
 * metadata container, where only admins write, until an admin unbinds it.
 */
export async function assertOrganizationProfileBindingPreserved(input: {
  readonly executor: DatabaseSession;
  readonly manifest: VerifiedDocumentLinkSetManifest;
}): Promise<void> {
  const { documentId, linkedContainerIds, organizationId } =
    input.manifest.state;
  const bindings = await input.executor
    .select({ organizationId: organizations.id })
    .from(organizations)
    .where(eq(organizations.profileDocumentId, documentId));
  if (bindings.length === 0) {
    return;
  }
  const [linkedContainerId] = linkedContainerIds;
  const [metadataContainer] =
    linkedContainerIds.length === 1 && linkedContainerId
      ? await input.executor
          .select({ id: containers.id })
          .from(containers)
          .where(
            and(
              eq(containers.id, linkedContainerId),
              eq(containers.organizationId, organizationId),
              eq(
                containers.systemSlot,
                await deriveOrganizationMetadataContainerSystemSlot({
                  organizationId,
                }),
              ),
            ),
          )
          .limit(1)
      : [];
  if (
    !metadataContainer ||
    bindings.some((binding) => binding.organizationId !== organizationId)
  ) {
    throw new DocumentMutationError(
      "Bound organization profile documents must remain exclusively in the organization metadata container",
      409,
    );
  }
}

export async function assertOrganizationProfileDocumentUnbound(input: {
  readonly documentId: string;
  readonly executor: DatabaseSession;
}): Promise<void> {
  const [binding] = await input.executor
    .select({ organizationId: organizations.id })
    .from(organizations)
    .where(eq(organizations.profileDocumentId, input.documentId))
    .limit(1);
  if (binding) {
    throw new DocumentMutationError(
      "Bound organization profile documents cannot be purged",
      409,
    );
  }
}
