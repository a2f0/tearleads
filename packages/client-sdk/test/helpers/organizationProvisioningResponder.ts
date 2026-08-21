import type { ApiClient } from "@symcrypt/api-client";
import type { OrganizationProvisioningRequest } from "@symcrypt/validators/request";
import type { OrganizationProvisioningResponse } from "@symcrypt/validators/response";
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
    profile
      ? profile.initialSync.outgoingUpdates.map((update) => update.id)
      : [],
  );
  const committedCoreMetadataUpdateIds = [
    request.initialRootMetadataDocument.initialSync,
    request.initialRosterProfileContainer?.initialMetadataSync,
    request.initialOrganizationMetadataContainer?.initialMetadataSync,
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
