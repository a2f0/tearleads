import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import type { CreateOrganizationResponse } from "@tearleads/validators/response";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import type { ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import {
  buildOrganizationProvisioningArtifacts,
  type OrganizationProvisioningArtifacts,
  type OrganizationProvisioningArtifactsInput,
  type ProvisionedSystemContainerSpec,
  persistOrganizationProvisioningState,
} from "../registration/registerIdentity";

export interface CreateOrganizationApi {
  createOrganization(
    request: CreateOrganizationRequest,
  ): Promise<CreateOrganizationResponse | null>;
}

export interface CreateOrganizationInput {
  apiClient: CreateOrganizationApi;
  dbClient: ExecSqlClientLike;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  encapsulationKeyPair: EncapsulationKeyPair;
  /**
   * Returns false once the identity that supplied the key pairs is no longer
   * active. Checked before the remote create (so a stale request is never
   * submitted) and again before local persistence: an identity switch closes
   * or renews the captured database client, so persisting would write another
   * identity's bootstrap — or throw — after the org already exists remotely.
   * The caller discards the result.
   */
  isIdentityCurrent?: (() => boolean) | undefined;
  /** Forwarded to the bootstrap persist; see its onPersistQueued doc. */
  onPersistQueued?: (() => void) | undefined;
  log?: ((message: string) => void) | undefined;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
  /** Overrides the seeded organization profile name; see registration. */
  organizationProfileName?: string | undefined;
  /**
   * App-owned system containers to provision atomically with the new
   * organization (e.g. a trash bin). See registration.
   */
  provisionedSystemContainers?:
    | ReadonlyArray<ProvisionedSystemContainerSpec>
    | undefined;
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
    provisionedSystemContainers: input.provisionedSystemContainers,
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
    initialRootMetadataDocument: artifacts.rootMetadataDocumentRequest,
    initialRosterProfileContainer:
      artifacts.rosterProfileBootstrap.containerRequest,
    initialRosterProfileDocument:
      artifacts.rosterProfileBootstrap.profileDocumentRequest,
    initialOrganizationMetadataContainer:
      artifacts.organizationMetadataBootstrap.containerRequest,
    initialOrganizationProfileDocument:
      artifacts.organizationMetadataBootstrap
        .organizationProfileDocumentRequest,
    initialSystemContainers: artifacts.systemContainerBootstraps.map(
      (systemContainer) => systemContainer.containerRequest,
    ),
  };

  if (input.isIdentityCurrent && !input.isIdentityCurrent()) {
    input.log?.(
      "Organization creation aborted: identity changed while building artifacts",
    );
    return null;
  }

  const response = await input.apiClient.createOrganization(request);
  if (!response) {
    return null;
  }

  if (input.isIdentityCurrent && !input.isIdentityCurrent()) {
    input.log?.(
      "Organization creation discarded: identity changed while provisioning",
    );
    return null;
  }

  input.log?.(`Organization created (${response.organizationId})`);
  await persistOrganizationProvisioningState({
    bootstrap: artifacts.bootstrap,
    canStartDurableMutation: input.isIdentityCurrent,
    onPersistQueued: input.onPersistQueued,
    containerId: rootContainerId,
    dbClient: input.dbClient,
    documentProjectors: input.documentProjectors,
    initialAdminGroup: artifacts.initialAdminGroup,
    initialMemberGroup: artifacts.initialMemberGroup,
    initialOrganizationPolicy: artifacts.initialOrganizationPolicy,
    log: input.log,
    logError: input.logError,
    organizationMetadataBootstrap: artifacts.organizationMetadataBootstrap,
    response,
    rootContainer: artifacts.rootContainer,
    rootMetadataDocument: artifacts.rootMetadataDocument,
    rootMetadataDocumentRequest: artifacts.rootMetadataDocumentRequest,
    rosterProfileBootstrap: artifacts.rosterProfileBootstrap,
    systemContainerBootstraps: artifacts.systemContainerBootstraps,
  });

  return response;
}
