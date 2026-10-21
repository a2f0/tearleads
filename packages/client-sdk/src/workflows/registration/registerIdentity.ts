import {
  type EncapsulationKeyPair,
  KeyingVerificationError,
  type SigningKeyPair,
} from "@tearleads/crypto";
import type {
  ProvisionedDocumentRequest,
  ProvisionedSystemContainerRequest,
  RegistrationRequest,
} from "@tearleads/validators/request";
import type { RegistrationResponse } from "@tearleads/validators/response";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import type { ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import type { LocalUserIdentityCandidate } from "../../data/trustedUserIdentity";
import { validateUserIdentityKeys } from "../../data/trustedUserIdentity";
import { buildOrganizationProvisioningArtifacts } from "./organizationProvisioning";
import { persistOrganizationProvisioningState } from "./organizationProvisioningPersistence";
import type { ProvisionedPrincipalHistoryPrimer } from "./provisionedPrincipalHistory";
import type { ProvisionedSystemContainerSpec } from "./provisioningBootstrapBuilders";

export interface RegistrationApi {
  registerUser(
    userId: string,
    organizationId: string,
    rootContainerId: string,
    signingPublicKey: Uint8Array,
    encapsulationPublicKey: Uint8Array,
    initialAdminGroup: RegistrationRequest["initialAdminGroup"],
    initialMemberGroup: RegistrationRequest["initialMemberGroup"],
    initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"],
    initialRootContainer: RegistrationRequest["initialRootContainer"],
    initialRootMetadataDocument: ProvisionedDocumentRequest,
    initialRosterProfileContainer: RegistrationRequest["initialRosterProfileContainer"],
    initialRosterProfileDocument: ProvisionedDocumentRequest | undefined,
    initialOrganizationMetadataContainer: ProvisionedSystemContainerRequest,
    initialOrganizationProfileDocument?: ProvisionedDocumentRequest | undefined,
    initialSystemContainers?: ProvisionedSystemContainerRequest[] | undefined,
  ): Promise<RegistrationResponse | null>;
}

export interface RegisterIdentityInput {
  apiClient: RegistrationApi;
  containerId: string;
  dbClient: ExecSqlClientLike;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  /**
   * Reports whether the identity that started this registration is still
   * current. Forwarded to the bootstrap persist's in-mutex currency check,
   * so an identity replaced while the persist waits for the mutation queue
   * cannot write its bootstrap through a client the replacement owns.
   */
  isIdentityCurrent?: (() => boolean) | undefined;
  /** @internal Forwarded to the bootstrap persist; test-only seam. */
  onPersistQueued?: (() => void) | undefined;
  encapsulationKeyPair: EncapsulationKeyPair;
  log?: ((message: string) => void) | undefined;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
  /**
   * Overrides the seeded personal-org profile name; defaults to "Personal Org".
   */
  organizationProfileName?: string | undefined;
  pinLocalUserIdentity: (
    userId: string,
    candidate: LocalUserIdentityCandidate,
  ) => Promise<void>;
  /** Seeds verified recovery progress for the founding policy heads. */
  primePrincipalHistory?: ProvisionedPrincipalHistoryPrimer | undefined;
  /**
   * App-owned system containers to provision atomically with the personal
   * organization (e.g. a trash bin). See {@link ProvisionedSystemContainerSpec}.
   */
  provisionedSystemContainers?:
    | ReadonlyArray<ProvisionedSystemContainerSpec>
    | undefined;
  /**
   * Overrides the seeded self roster-profile nickname; defaults to "You". The
   * demo host passes each pane's peer-labeled self name ("Peer 1 (You)").
   */
  rosterProfileNickname?: string | undefined;
  signingKeyFingerprint?: string | null | undefined;
  signingKeyPair: SigningKeyPair;
}

export async function registerIdentity(
  input: RegisterIdentityInput,
): Promise<RegistrationResponse | null> {
  input.log?.("Registering identity...");
  await validateUserIdentityKeys({
    candidate: {
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
      signingKeyFingerprint: input.signingKeyFingerprint,
      signingPublicKey: input.signingKeyPair.signingPublicKey,
    },
  });

  const newUserId = crypto.randomUUID();
  const artifacts = await buildOrganizationProvisioningArtifacts({
    encapsulationKeyPair: input.encapsulationKeyPair,
    organizationProfileName: input.organizationProfileName,
    provisionedSystemContainers: input.provisionedSystemContainers,
    rootContainerId: input.containerId,
    rosterProfileNickname: input.rosterProfileNickname,
    signingKeyPair: input.signingKeyPair,
    userId: newUserId,
  });

  const response = await input.apiClient.registerUser(
    newUserId,
    artifacts.organizationId,
    input.containerId,
    input.signingKeyPair.signingPublicKey,
    input.encapsulationKeyPair.publicKey,
    artifacts.initialAdminGroup,
    artifacts.initialMemberGroup,
    artifacts.initialOrganizationPolicy,
    artifacts.initialRootContainer,
    artifacts.rootMetadataDocumentRequest,
    artifacts.rosterProfileBootstrap.containerRequest,
    artifacts.rosterProfileBootstrap.profileDocumentRequest,
    artifacts.organizationMetadataBootstrap.containerRequest,
    artifacts.organizationMetadataBootstrap.organizationProfileDocumentRequest,
    artifacts.systemContainerBootstraps.map(
      (systemContainer) => systemContainer.containerRequest,
    ),
  );
  if (!response) {
    return null;
  }
  if (response.userId !== newUserId) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "Registration response user does not match the requested identity",
    );
  }
  // Pinned only once the server has confirmed this user, and before anything
  // is persisted under it. The trust store binds each signing key to one user,
  // so a pin for an id the server never accepted — a retry after a lost
  // response, or a restored key that is already registered — would later
  // refuse the key's real user at login. Like the persistence below, it is a
  // durable write, so it is skipped once the registering identity has been
  // replaced: the caller discards this result.
  if (input.isIdentityCurrent?.() ?? true) {
    await input.pinLocalUserIdentity(newUserId, {
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
      signingPublicKey: input.signingKeyPair.signingPublicKey,
    });
  }

  input.log?.(`Key registered (${response.userId})`);
  await persistOrganizationProvisioningState({
    bootstrap: artifacts.bootstrap,
    canStartDurableMutation: input.isIdentityCurrent,
    onPersistQueued: input.onPersistQueued,
    containerId: input.containerId,
    dbClient: input.dbClient,
    documentProjectors: input.documentProjectors,
    initialAdminGroup: artifacts.initialAdminGroup,
    initialMemberGroup: artifacts.initialMemberGroup,
    initialOrganizationPolicy: artifacts.initialOrganizationPolicy,
    log: input.log,
    logError: input.logError,
    organizationMetadataBootstrap: artifacts.organizationMetadataBootstrap,
    primePrincipalHistory: input.primePrincipalHistory,
    response,
    rootContainer: artifacts.rootContainer,
    rootMetadataDocument: artifacts.rootMetadataDocument,
    rootMetadataDocumentRequest: artifacts.rootMetadataDocumentRequest,
    rosterProfileBootstrap: artifacts.rosterProfileBootstrap,
    systemContainerBootstraps: artifacts.systemContainerBootstraps,
  });

  return response;
}
