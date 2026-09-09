import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { OrganizationProvisioningError } from "./provisionOrganizationError";

export async function createRootContainer(
  tx: DatabaseTransaction,
  rootContainerId: string,
  organizationId: string,
) {
  const [container] = await tx
    .insert(containers)
    .values({
      depth: 0,
      id: rootContainerId,
      organizationId,
      parentId: null,
    })
    .onConflictDoNothing({ target: containers.id })
    .returning({ id: containers.id });
  if (!container) {
    throw new OrganizationProvisioningError(
      "Root container ID is unavailable",
      409,
    );
  }
  return container;
}
