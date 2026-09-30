import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { containerKeyEpochs, containers } from "@tearleads/api-shared/schema";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { eq } from "drizzle-orm";

/**
 * Clients open a custom group's name only through the organization metadata
 * container's keyring. The API cannot open the ciphertext, but it can refuse a
 * name citing any key other than an epoch of that container, which no honest
 * member could resolve.
 */
export async function isOrganizationGroupMetadataKey(input: {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<boolean> {
  // Looked up by the text epoch id so an arbitrary cited container id never
  // reaches a uuid comparison.
  const [epoch] = await input.executor
    .select({
      containerId: containers.id,
      organizationId: containers.organizationId,
      systemSlot: containers.systemSlot,
    })
    .from(containerKeyEpochs)
    .innerJoin(containers, eq(containers.id, containerKeyEpochs.containerId))
    .where(eq(containerKeyEpochs.id, input.containerKeyEpochId))
    .limit(1);
  return (
    epoch?.containerId === input.containerId &&
    epoch.organizationId === input.organizationId &&
    epoch.systemSlot ===
      (await deriveOrganizationMetadataContainerSystemSlot({
        organizationId: input.organizationId,
      }))
  );
}
