import type { ApiClient } from "@tearleads/api-client";
import {
  isProvisionedDocumentRequest,
  isProvisionedSystemContainerRequest,
  type OrganizationProvisioningRequest,
} from "@tearleads/validators/request";
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

  // Echo the Members-granted organization metadata container the client sent, so
  // local provisioning persists it (and its system slot) exactly as production
  // does. Without it, the org-name reader's cross-org fallback — which locates
  // this container by its deterministic system slot — has nothing to find.
  const organizationMetadataContainer =
    request.initialOrganizationMetadataContainer;
  const organizationMetadataContainerResponse = organizationMetadataContainer
    ? await createMutationResponseFromRequest(
        organizationMetadataContainer.container,
      )
    : undefined;
  const organizationMetadataMetadataDocument = organizationMetadataContainer
    ? await createResponseFromRequest(
        organizationMetadataContainer.metadataDocument,
      )
    : undefined;
  if (organizationMetadataContainerResponse && organizationMetadataContainer) {
    organizationMetadataContainerResponse.systemSlot =
      organizationMetadataContainer.systemSlot ?? null;
  }

  // Echo the additional app-owned system containers (e.g. the Explorer Trash
  // bin) the client sent, so local provisioning persists each one and its
  // system slot exactly as production does.
  const systemContainers = await Promise.all(
    (request.initialSystemContainers ?? []).map(async (systemContainer) => {
      const container = await createMutationResponseFromRequest(
        systemContainer.container,
      );
      container.systemSlot = systemContainer.systemSlot ?? null;
      const metadataDocument = await createResponseFromRequest(
        systemContainer.metadataDocument,
      );
      return { container, metadataDocument };
    }),
  );
  const committedProfileUpdateIds = [
    request.initialRosterProfileDocument,
    request.initialOrganizationProfileDocument,
  ].flatMap((profile) =>
    isProvisionedDocumentRequest(profile)
      ? profile.initialSync.outgoingUpdates.map((update) => update.id)
      : [],
  );
  const committedCoreMetadataUpdateIds = [
    isProvisionedDocumentRequest(request.initialRootMetadataDocument)
      ? request.initialRootMetadataDocument.initialSync
      : undefined,
    isProvisionedSystemContainerRequest(request.initialRosterProfileContainer)
      ? request.initialRosterProfileContainer.initialMetadataSync
      : undefined,
    isProvisionedSystemContainerRequest(
      request.initialOrganizationMetadataContainer,
    )
      ? request.initialOrganizationMetadataContainer.initialMetadataSync
      : undefined,
  ].flatMap((syncRequest) =>
    syncRequest ? syncRequest.outgoingUpdates.map((update) => update.id) : [],
  );

  return {
    userId: request.userId,
    organizationId: request.organizationId,
    rootContainerId: request.rootContainerId,
    rootMetadataDocumentId: rootMetadataDocument.id,
    rootMetadataAccessEpoch: 1,
    rootMetadataAccessStateHash:
      request.initialRootContainer.expectedManifestHash,
    rootMetadataDocument,
    committedCoreMetadataUpdateIds,
    committedProfileUpdateIds,
    rosterProfileContainer: {
      container: rosterProfileContainerResponse,
      metadataDocument: rosterProfileMetadataDocument,
    },
    rosterProfileContainerId: rosterProfileContainerResponse.containerId,
    rosterProfileDocument,
    rosterProfileDocumentId: rosterProfileDocument.id,
    organizationProfileDocument,
    organizationProfileDocumentId: organizationProfileDocument.id,
    ...(organizationMetadataContainerResponse &&
    organizationMetadataMetadataDocument
      ? {
          organizationMetadataContainer: {
            container: organizationMetadataContainerResponse,
            metadataDocument: organizationMetadataMetadataDocument,
          },
          organizationMetadataContainerId:
            organizationMetadataContainerResponse.containerId,
        }
      : {}),
    ...(systemContainers.length > 0 ? { systemContainers } : {}),
  };
}

export async function respondToRegistration(
  args: Parameters<ApiClient["registerUser"]>,
) {
  const [
    userId,
    organizationId,
    rootContainerId,
    ,
    ,
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    initialRootContainer,
    initialRootMetadataDocument,
    initialRosterProfileContainer,
    initialRosterProfileDocument,
    initialOrganizationMetadataContainer,
    initialOrganizationProfileDocument,
    initialSystemContainers,
  ] = args;

  return {
    ...(await respondToOrganizationProvisioning({
      userId,
      organizationId,
      rootContainerId,
      initialAdminGroup,
      initialMemberGroup,
      initialOrganizationPolicy,
      initialRootContainer,
      initialRootMetadataDocument,
      initialRosterProfileContainer,
      initialRosterProfileDocument,
      initialOrganizationMetadataContainer,
      initialOrganizationProfileDocument,
      initialSystemContainers,
    })),
    challenge: "a".repeat(64),
  };
}
