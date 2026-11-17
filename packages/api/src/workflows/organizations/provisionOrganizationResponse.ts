import type { OrganizationProvisioningResponse } from "@tearleads/validators/response";
import type { ProvisionedOrganization } from "./provisionOrganization";

/** The response without the commit position read after its transaction. */
export type OrganizationProvisioningResult = Omit<
  OrganizationProvisioningResponse,
  "commitLsn" | "commitLsnMode"
>;

/**
 * Projects a {@link ProvisionedOrganization} into the result shared by
 * registration and additional-organization creation, flattening the optional
 * roster/organization profile artifacts into their id fields. `userId` is the
 * founding admin (the new user for registration, the caller otherwise). The
 * caller adds the commit position once the transaction has committed.
 */
export function toOrganizationProvisioningResponse(
  userId: string,
  provisioned: ProvisionedOrganization,
): OrganizationProvisioningResult {
  return {
    userId,
    organizationId: provisioned.organizationId,
    rootContainerId: provisioned.rootContainerId,
    rootMetadataDocumentId: provisioned.rootMetadataDocumentId,
    rootMetadataAccessEpoch: provisioned.rootMetadataAccessEpoch,
    rootMetadataAccessStateHash: provisioned.rootMetadataAccessStateHash,
    rootMetadataDocument: provisioned.rootMetadataDocument,
    committedCoreMetadataUpdateIds: provisioned.committedCoreMetadataUpdateIds,
    committedProfileUpdateIds: provisioned.committedProfileUpdateIds,
    ...(provisioned.rosterProfileContainer
      ? {
          rosterProfileContainer: provisioned.rosterProfileContainer,
          rosterProfileContainerId:
            provisioned.rosterProfileContainer.container.containerId,
        }
      : {}),
    ...(provisioned.rosterProfileDocument
      ? {
          rosterProfileDocument: provisioned.rosterProfileDocument,
          rosterProfileDocumentId: provisioned.rosterProfileDocument.id,
        }
      : {}),
    organizationMetadataContainer: provisioned.organizationMetadataContainer,
    organizationMetadataContainerId:
      provisioned.organizationMetadataContainer.container.containerId,
    ...(provisioned.organizationProfileDocument
      ? {
          organizationProfileDocument: provisioned.organizationProfileDocument,
          organizationProfileDocumentId:
            provisioned.organizationProfileDocument.id,
        }
      : {}),
    systemContainers: provisioned.systemContainers,
  };
}
