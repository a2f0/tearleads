import type { ApiClient } from "@tearleads/api-client";
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
  const rootMetadataDocument = await createResponseFromRequest(
    request.initialRootMetadataDocument,
  );
  const rosterProfileContainer = request.initialRosterProfileContainer;
  const rosterProfileMetadataDocument = rosterProfileContainer
    ? await createResponseFromRequest(rosterProfileContainer.metadataDocument)
    : undefined;
  const rosterProfileContainerResponse = rosterProfileContainer
    ? await createMutationResponseFromRequest(rosterProfileContainer.container)
    : undefined;
  if (rosterProfileContainerResponse && rosterProfileContainer) {
    rosterProfileContainerResponse.systemSlot =
      rosterProfileContainer.systemSlot ?? null;
  }
  const rosterProfileDocument = request.initialRosterProfileDocument
    ? await createResponseFromRequest(request.initialRosterProfileDocument)
    : undefined;
  const organizationProfileDocument = request.initialOrganizationProfileDocument
    ? await createResponseFromRequest(
        request.initialOrganizationProfileDocument,
      )
    : undefined;

  // Echo the required independent metadata root and its reserved system slot so
  // persistence and encrypted-name tests exercise the production topology.
  const organizationMetadataContainer =
    request.initialOrganizationMetadataContainer;
  const organizationMetadataContainerResponse =
    await createMutationResponseFromRequest(
      organizationMetadataContainer.container,
    );
  const organizationMetadataMetadataDocument = await createResponseFromRequest(
    organizationMetadataContainer.metadataDocument,
  );
  organizationMetadataContainerResponse.systemSlot =
    organizationMetadataContainer.systemSlot;

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
    profile
      ? profile.initialSync.outgoingUpdates.map((update) => update.id)
      : [],
  );
  const committedCoreMetadataUpdateIds = [
    request.initialRootMetadataDocument.initialSync,
    request.initialRosterProfileContainer?.initialMetadataSync,
    request.initialOrganizationMetadataContainer.initialMetadataSync,
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
    ...(rosterProfileContainerResponse && rosterProfileMetadataDocument
      ? {
          rosterProfileContainer: {
            container: rosterProfileContainerResponse,
            metadataDocument: rosterProfileMetadataDocument,
          },
          rosterProfileContainerId: rosterProfileContainerResponse.containerId,
        }
      : {}),
    ...(rosterProfileDocument
      ? {
          rosterProfileDocument,
          rosterProfileDocumentId: rosterProfileDocument.id,
        }
      : {}),
    ...(organizationProfileDocument
      ? {
          organizationProfileDocument,
          organizationProfileDocumentId: organizationProfileDocument.id,
        }
      : {}),
    organizationMetadataContainer: {
      container: organizationMetadataContainerResponse,
      metadataDocument: organizationMetadataMetadataDocument,
    },
    organizationMetadataContainerId:
      organizationMetadataContainerResponse.containerId,
    systemContainers,
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
