import type { OrganizationProvisioningRequest } from "@tearleads/validators/request";
import type { OrganizationProvisioningResponse } from "@tearleads/validators/response";
import { createMutationResponseFromRequest } from "./containerFixtures";
import { createResponseFromRequest } from "./documentFixtures";

/**
 * Builds a plausible server response for organization provisioning from the
 * request the client signed. Shared by the registration/create-organization
 * workflow tests so they can drive local persistence without a real server.
 */
export async function respondToOrganizationProvisioning(
  request: OrganizationProvisioningRequest,
): Promise<OrganizationProvisioningResponse> {
  if (
    !request.initialRosterProfileContainer ||
    !request.initialRosterProfileDocument ||
    !request.initialOrganizationProfileDocument
  ) {
    throw new Error("Expected roster and organization profile requests");
  }
  const rootMetadataDocument = await createResponseFromRequest(
    request.initialRootMetadataDocument,
  );
  const rosterProfileMetadataDocument = await createResponseFromRequest(
    request.initialRosterProfileContainer.metadataDocument,
  );
  const rosterProfileContainerResponse =
    await createMutationResponseFromRequest(
      request.initialRosterProfileContainer.container,
    );
  rosterProfileContainerResponse.systemSlot =
    request.initialRosterProfileContainer.systemSlot ?? null;
  const rosterProfileDocument = await createResponseFromRequest(
    request.initialRosterProfileDocument,
  );
  const organizationProfileDocument = await createResponseFromRequest(
    request.initialOrganizationProfileDocument,
  );

  return {
    userId: request.userId,
    organizationId: request.organizationId,
    rootContainerId: request.rootContainerId,
    rootMetadataDocumentId: rootMetadataDocument.id,
    rootMetadataAccessEpoch: 1,
    rootMetadataAccessStateHash:
      rootMetadataDocument.accessManifest.manifestHash,
    rootMetadataDocument,
    rosterProfileContainer: {
      container: rosterProfileContainerResponse,
      metadataDocument: rosterProfileMetadataDocument,
    },
    rosterProfileContainerId: rosterProfileContainerResponse.containerId,
    rosterProfileDocument,
    rosterProfileDocumentId: rosterProfileDocument.id,
    organizationProfileDocument,
    organizationProfileDocumentId: organizationProfileDocument.id,
  };
}
