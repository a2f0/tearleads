import type { OrganizationProvisioningResponse } from "@tearleads/validators/response";
import type { ProvisionedOrganization } from "./provisionOrganization";

/**
 * Projects a {@link ProvisionedOrganization} into the wire response shared by
 * registration and additional-organization creation, flattening the optional
 * roster/organization profile artifacts into their id fields. `userId` is the
 * founding admin (the new user for registration, the caller otherwise).
 */
export function toOrganizationProvisioningResponse(
  userId: string,
  provisioned: ProvisionedOrganization,
): OrganizationProvisioningResponse {
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
    ...(provisioned.organizationMetadataContainer
      ? {
          organizationMetadataContainer:
            provisioned.organizationMetadataContainer,
          organizationMetadataContainerId:
            provisioned.organizationMetadataContainer.container.containerId,
        }
      : {}),
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
