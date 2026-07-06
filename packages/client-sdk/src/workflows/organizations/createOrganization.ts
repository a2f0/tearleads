import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import type { CreateOrganizationResponse } from "@tearleads/validators/response";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import type { ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import {
  buildOrganizationProvisioningArtifacts,
  type OrganizationProvisioningArtifacts,
  type OrganizationProvisioningArtifactsInput,
  persistOrganizationProvisioningState,
} from "../registration/registerIdentity";

export interface CreateOrganizationApi {
  createOrganization(
    request: CreateOrganizationRequest,
  ): Promise<CreateOrganizationResponse | null>;
}

export interface CreateOrganizationInput {
  apiClient: CreateOrganizationApi;
  dbClient?: ExecSqlClientLike | null | undefined;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  encapsulationKeyPair: EncapsulationKeyPair;
  log?: ((message: string) => void) | undefined;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
  /** Overrides the seeded organization profile name; see registration. */
  organizationProfileName?: string | undefined;
  /** Overrides the seeded self roster-profile nickname; see registration. */
  rosterProfileNickname?: string | undefined;
  signingKeyPair: SigningKeyPair;
  /**
   * The already-registered user creating the organization; they become its
   * founding admin. The server independently requires this to match the
   * authenticated session.
   */
  userId: string;
}

/**
 * Provisions an additional organization for an already-registered user, reusing
 * the exact artifact-build and local-persistence path as registration
 * ({@link buildOrganizationProvisioningArtifacts} /
 * {@link persistOrganizationProvisioningState}). Unlike registration it mints a
 * fresh root container id, signs with the caller's existing identity, and needs
 * no auth challenge — the user is already authenticated.
 */
export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResponse | null> {
  input.log?.("Creating organization...");

  const rootContainerId = crypto.randomUUID();
  const artifactsInput: OrganizationProvisioningArtifactsInput = {
    encapsulationKeyPair: input.encapsulationKeyPair,
    organizationProfileName: input.organizationProfileName,
    rootContainerId,
    rosterProfileNickname: input.rosterProfileNickname,
    signingKeyPair: input.signingKeyPair,
    userId: input.userId,
  };
  const artifacts: OrganizationProvisioningArtifacts =
    await buildOrganizationProvisioningArtifacts(artifactsInput);

  const request: CreateOrganizationRequest = {
    userId: input.userId,
    organizationId: artifacts.organizationId,
    rootContainerId,
    initialAdminGroup: artifacts.initialAdminGroup,
    initialMemberGroup: artifacts.initialMemberGroup,
    initialOrganizationPolicy: artifacts.initialOrganizationPolicy,
    initialRootContainer: artifacts.initialRootContainer,
    initialRootMetadataDocument: artifacts.rootMetadataDocument.plan.request,
    initialRosterProfileContainer:
      artifacts.rosterProfileBootstrap.containerRequest,
    initialRosterProfileDocument:
      artifacts.rosterProfileBootstrap.profileDocumentRequest,
    initialOrganizationMetadataContainer:
      artifacts.organizationMetadataBootstrap.containerRequest,
    initialOrganizationProfileDocument:
      artifacts.organizationMetadataBootstrap.organizationProfileDocument.plan
        .request,
  };

  const response = await input.apiClient.createOrganization(request);
  if (!response) {
    return null;
  }

  input.log?.(`Organization created (${response.organizationId})`);
  await persistOrganizationProvisioningState({
    bootstrap: artifacts.bootstrap,
    containerId: rootContainerId,
    dbClient: input.dbClient,
    documentProjectors: input.documentProjectors,
    initialAdminGroup: artifacts.initialAdminGroup,
    initialMemberGroup: artifacts.initialMemberGroup,
    log: input.log,
    logError: input.logError,
    organizationMetadataBootstrap: artifacts.organizationMetadataBootstrap,
    response,
    rootMetadataDocument: artifacts.rootMetadataDocument,
    rosterProfileBootstrap: artifacts.rosterProfileBootstrap,
  });

  return response;
}
