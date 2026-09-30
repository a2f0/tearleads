import { db } from "@tearleads/api-shared/postgres";
import { containerKeyEpochs, containers } from "@tearleads/api-shared/schema";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { and, desc, eq } from "drizzle-orm";
import invariant from "invariant";

export async function loadOrganizationMetadataContainerId(
  organizationId: string,
): Promise<string> {
  const [container] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, organizationId),
        eq(
          containers.systemSlot,
          await deriveOrganizationMetadataContainerSystemSlot({
            organizationId,
          }),
        ),
      ),
    );
  invariant(container, "expected the organization metadata container");
  return container.id;
}

/**
 * The key a custom group name cites. Fixtures encrypt under test key material;
 * the API checks only that the citation names a metadata-container epoch.
 */
export async function loadOrganizationGroupMetadataKey(
  organizationId: string,
): Promise<{
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly keyMaterial: Uint8Array;
  readonly organizationId: string;
}> {
  const containerId = await loadOrganizationMetadataContainerId(organizationId);
  const [epoch] = await db
    .select({ id: containerKeyEpochs.id })
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.containerId, containerId))
    .orderBy(desc(containerKeyEpochs.keyEpoch))
    .limit(1);
  invariant(epoch, "expected an organization metadata key epoch");
  return {
    containerId,
    containerKeyEpochId: epoch.id,
    keyMaterial: new Uint8Array(32).fill(7),
    organizationId,
  };
}
