import { bytesToBase64 } from "@tearleads/encoding";
import type { OrganizationProvisioningResponse } from "@tearleads/validators/response";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import { persistedDocumentCreateStateFromResponse } from "../../data/documents/shared/responses";
import type { ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import type { OrganizationProvisioningArtifacts } from "./organizationProvisioningArtifacts";
import { persistRegistrationBootstrapFromExecSql } from "./persistRegistrationBootstrap";
import {
  buildOrganizationProfileBootstrapInput,
  buildRosterProfileBootstrapInput,
} from "./profileBootstrapPersistence";
import { provisioningAcknowledgedAccessHeads } from "./provisioningAcknowledgement";
import {
  principalPolicyBundleFromInitialGroupRequest,
  principalPolicyBundleFromInitialOrganizationRequest,
} from "./registrationPrincipalPolicyPersistence";

type PersistOrganizationProvisioningStateInput = Pick<
  OrganizationProvisioningArtifacts,
  | "bootstrap"
  | "initialAdminGroup"
  | "initialMemberGroup"
  | "initialOrganizationPolicy"
  | "organizationMetadataBootstrap"
  | "rootContainer"
  | "rootMetadataDocument"
  | "rootMetadataDocumentRequest"
  | "rosterProfileBootstrap"
  | "systemContainerBootstraps"
> & {
  /** Forwarded to the bootstrap persist's in-mutex currency check. */
  readonly canStartDurableMutation?: (() => boolean) | undefined;
  /** Forwarded to the bootstrap persist; see its onPersistQueued doc. */
  readonly onPersistQueued?: (() => void) | undefined;
  readonly containerId: string;
  readonly dbClient: ExecSqlClientLike;
  readonly documentProjectors?: DocumentProjectorRegistryInput | undefined;
  readonly log?: ((message: string) => void) | undefined;
  readonly logError?:
    | ((message: string | Error, cause?: unknown) => void)
    | undefined;
  readonly response: OrganizationProvisioningResponse;
};

type PersistBootstrapInput = Parameters<
  typeof persistRegistrationBootstrapFromExecSql
>[1];

function coreMetadataInitialUpdateCommitted(
  response: OrganizationProvisioningResponse,
  updateId?: string,
): boolean {
  return (
    updateId !== undefined &&
    response.committedCoreMetadataUpdateIds.includes(updateId)
  );
}

function buildRosterProfileContainerBootstrapInput(
  input: PersistOrganizationProvisioningStateInput,
): PersistBootstrapInput["rosterProfileContainer"] {
  const container = input.response.rosterProfileContainer;
  if (!container) {
    return;
  }

  return {
    accessEpoch: container.container.manifestHead.epoch,
    accessStateHash: container.container.manifestHead.manifestHash,
    containerId: input.rosterProfileBootstrap.containerId,
    createdAt: container.container.createdAt,
    metadataDocumentId: container.metadataDocument.id,
    metadataInitialUpdate:
      input.rosterProfileBootstrap.containerMetadataInitialUpdate,
    metadataInitialUpdateCommitted: coreMetadataInitialUpdateCommitted(
      input.response,
      input.rosterProfileBootstrap.containerRequest.initialMetadataSync
        .outgoingUpdates[0]?.id,
    ),
    metadataSnapshot: bytesToBase64(
      input.rosterProfileBootstrap.containerMetadataInitialUpdate,
    ),
    metadataState: persistedDocumentCreateStateFromResponse(
      input.rosterProfileBootstrap.containerMetadataDocument.plan,
      container.metadataDocument,
    ),
    systemSlot: input.rosterProfileBootstrap.systemSlot,
    updatedAt: container.container.updatedAt,
  };
}

function buildOrganizationMetadataContainerBootstrapInput(
  input: PersistOrganizationProvisioningStateInput,
): PersistBootstrapInput["organizationMetadataContainer"] {
  const container = input.response.organizationMetadataContainer;
  if (!container) {
    return;
  }

  return {
    accessEpoch: container.container.manifestHead.epoch,
    accessStateHash: container.container.manifestHead.manifestHash,
    containerId: input.organizationMetadataBootstrap.containerId,
    createdAt: container.container.createdAt,
    metadataDocumentId: container.metadataDocument.id,
    metadataInitialUpdate:
      input.organizationMetadataBootstrap.containerMetadataInitialUpdate,
    metadataInitialUpdateCommitted: coreMetadataInitialUpdateCommitted(
      input.response,
      input.organizationMetadataBootstrap.containerRequest.initialMetadataSync
        .outgoingUpdates[0]?.id,
    ),
    metadataSnapshot: bytesToBase64(
      input.organizationMetadataBootstrap.containerMetadataInitialUpdate,
    ),
    metadataState: persistedDocumentCreateStateFromResponse(
      input.organizationMetadataBootstrap.containerMetadataDocument.plan,
      container.metadataDocument,
    ),
    systemSlot: input.organizationMetadataBootstrap.systemSlot,
    updatedAt: container.container.updatedAt,
  };
}

function buildSystemContainersBootstrapInput(
  input: PersistOrganizationProvisioningStateInput,
): PersistBootstrapInput["systemContainers"] {
  const responses = input.response.systemContainers;
  if (responses.length === 0) {
    return;
  }
  const responseByContainerId = new Map(
    responses.map((response) => [response.container.containerId, response]),
  );
  const entries: NonNullable<PersistBootstrapInput["systemContainers"]> = [];
  for (const bootstrap of input.systemContainerBootstraps) {
    const response = responseByContainerId.get(bootstrap.containerId);
    if (!response) {
      continue;
    }
    entries.push({
      accessEpoch: response.container.manifestHead.epoch,
      accessStateHash: response.container.manifestHead.manifestHash,
      containerId: bootstrap.containerId,
      createdAt: response.container.createdAt,
      icon: bootstrap.icon,
      metadataDocumentId: response.metadataDocument.id,
      metadataSnapshot: bytesToBase64(bootstrap.containerMetadataInitialUpdate),
      metadataState: persistedDocumentCreateStateFromResponse(
        bootstrap.containerMetadataDocument.plan,
        response.metadataDocument,
      ),
      name: bootstrap.name,
      systemSlot: bootstrap.systemSlot,
      updatedAt: response.container.updatedAt,
    });
  }
  return entries.length > 0 ? entries : undefined;
}

async function buildProvisioningPersistenceArtifacts(
  input: PersistOrganizationProvisioningStateInput,
) {
  const acknowledgedAccessHeads = await provisioningAcknowledgedAccessHeads({
    expectedOrganizationId: input.rootContainer.plan.state.organizationId,
    expectedUserId: input.rootContainer.plan.event.signerUserId,
    organizationMetadata: {
      containerPlan: input.organizationMetadataBootstrap.containerPlan.plan,
      metadataDocumentPlan:
        input.organizationMetadataBootstrap.containerMetadataDocument.plan,
    },
    organizationProfileDocumentPlan:
      input.organizationMetadataBootstrap.organizationProfileDocument.plan,
    response: input.response,
    rootContainerPlan: input.rootContainer.plan,
    rootMetadataDocumentPlan: input.rootMetadataDocument.plan,
    rosterProfile: {
      containerPlan: input.rosterProfileBootstrap.containerPlan.plan,
      metadataDocumentPlan:
        input.rosterProfileBootstrap.containerMetadataDocument.plan,
    },
    rosterProfileDocumentPlan:
      input.rosterProfileBootstrap.profileDocument.plan,
    systemContainers: input.systemContainerBootstraps.map((bootstrap) => ({
      containerPlan: bootstrap.containerPlan.plan,
      metadataDocumentPlan: bootstrap.containerMetadataDocument.plan,
    })),
  });
  const [
    initialAdminGroupPolicy,
    initialMemberGroupPolicy,
    initialOrganizationPolicy,
  ] = await Promise.all([
    principalPolicyBundleFromInitialGroupRequest(input.initialAdminGroup),
    principalPolicyBundleFromInitialGroupRequest(input.initialMemberGroup),
    principalPolicyBundleFromInitialOrganizationRequest(
      input.initialOrganizationPolicy,
    ),
  ]);
  return {
    acknowledgedAccessHeads,
    initialAdminGroupPolicy,
    initialMemberGroupPolicy,
    initialOrganizationPolicy,
    organizationMetadataContainer:
      buildOrganizationMetadataContainerBootstrapInput(input),
    organizationProfileDocument: buildOrganizationProfileBootstrapInput({
      containerId: input.organizationMetadataBootstrap.containerId,
      materializedDocument:
        input.organizationMetadataBootstrap.organizationProfileDocument,
      request:
        input.organizationMetadataBootstrap.organizationProfileDocumentRequest,
      response: input.response,
      snapshot: input.organizationMetadataBootstrap.organizationProfileSnapshot,
    }),
    rosterProfileContainer: buildRosterProfileContainerBootstrapInput(input),
    rosterProfileDocument: buildRosterProfileBootstrapInput({
      containerId: input.rosterProfileBootstrap.containerId,
      initialUpdate: input.rosterProfileBootstrap.profileDocumentInitialUpdate,
      materializedDocument: input.rosterProfileBootstrap.profileDocument,
      request: input.rosterProfileBootstrap.profileDocumentRequest,
      response: input.response,
    }),
    systemContainers: buildSystemContainersBootstrapInput(input),
  };
}

export async function persistOrganizationProvisioningState(
  input: PersistOrganizationProvisioningStateInput,
): Promise<void> {
  try {
    const artifacts = await buildProvisioningPersistenceArtifacts(input);
    const persisted = await persistRegistrationBootstrapFromExecSql(
      createExecSql(input.dbClient),
      {
        acknowledgedAccessHeads: artifacts.acknowledgedAccessHeads,
        canStartDurableMutation: input.canStartDurableMutation,
        onPersistQueued: input.onPersistQueued,
        containerId: input.containerId,
        documentProjectors: input.documentProjectors,
        initialAdminGroupPolicy: artifacts.initialAdminGroupPolicy,
        initialMemberGroupPolicy: artifacts.initialMemberGroupPolicy,
        initialOrganizationPolicy: artifacts.initialOrganizationPolicy,
        organizationId: input.response.organizationId,
        // The provisioning response does not expose the root container's own
        // timestamps. Its metadata document is created in the same transaction,
        // so its server timestamp is the acknowledged remote anchor for the
        // locally persisted root row.
        rootContainerServerTimestamp:
          input.response.rootMetadataDocument.createdAt,
        rootMetadataAccessEpoch: input.response.rootMetadataAccessEpoch,
        rootMetadataAccessStateHash: input.response.rootMetadataAccessStateHash,
        rootMetadataDocumentId: input.response.rootMetadataDocumentId,
        rootMetadataInitialUpdate: input.bootstrap.initialUpdate,
        rootMetadataInitialUpdateCommitted: coreMetadataInitialUpdateCommitted(
          input.response,
          input.rootMetadataDocumentRequest.initialSync.outgoingUpdates[0]?.id,
        ),
        rootMetadataSnapshot: bytesToBase64(input.bootstrap.initialUpdate),
        rootMetadataState: persistedDocumentCreateStateFromResponse(
          input.rootMetadataDocument.plan,
          input.response.rootMetadataDocument,
        ),
        ...(artifacts.rosterProfileContainer
          ? { rosterProfileContainer: artifacts.rosterProfileContainer }
          : {}),
        ...(artifacts.organizationMetadataContainer
          ? {
              organizationMetadataContainer:
                artifacts.organizationMetadataContainer,
            }
          : {}),
        ...(artifacts.organizationProfileDocument
          ? {
              organizationProfileDocument:
                artifacts.organizationProfileDocument,
            }
          : {}),
        ...(artifacts.rosterProfileDocument
          ? { rosterProfileDocument: artifacts.rosterProfileDocument }
          : {}),
        ...(artifacts.systemContainers
          ? { systemContainers: artifacts.systemContainers }
          : {}),
        userId: input.response.userId,
      },
    );
    input.log?.(
      persisted
        ? "Local organization bootstrap persisted"
        : "Local organization bootstrap skipped: identity replaced",
    );
  } catch (error: unknown) {
    if (input.logError) {
      input.logError("Failed to persist registration data", error);
    } else {
      console.error("Failed to persist registration data:", error);
    }
    throw error;
  }
}
