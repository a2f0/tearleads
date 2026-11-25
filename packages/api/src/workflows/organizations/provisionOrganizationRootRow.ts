import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { claimPurgedObjectReservation } from "../billing/purgedObjectReservations";
import { OrganizationProvisioningError } from "./provisionOrganizationError";

/**
 * Inserts the new organization's root container. An id that is live, or that
 * an organization purge reserved for another user's recovery, is unavailable.
 */
export async function createRootContainer(
  tx: DatabaseTransaction,
  input: {
    readonly organizationId: string;
    readonly rootContainerId: string;
    readonly userId: string;
  },
) {
  const [container] = await tx
    .insert(containers)
    .values({
      depth: 0,
      id: input.rootContainerId,
      organizationId: input.organizationId,
      parentId: null,
    })
    .onConflictDoNothing({ target: containers.id })
    .returning({ id: containers.id });
  // After the insert, which waits out a purge deleting this row, so this read
  // sees the reservation that purge committed with it.
  if (
    !container ||
    !(await claimPurgedObjectReservation(tx, {
      objectId: input.rootContainerId,
      objectKind: "container",
      userId: input.userId,
    }))
  ) {
    throw new OrganizationProvisioningError(
      "Root container ID is unavailable",
      409,
    );
  }
  return container;
}
