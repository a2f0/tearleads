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
import { deriveRegistrationOrganizationId } from "./bootstrapRootContainer";
import {
  isLegalTermsOutdatedFailure,
  LegalTermsOutdatedError,
  REGISTRATION_REQUEST,
  type RegistrationRequestFailure,
} from "./legalTermsOutdatedError";
import { buildOrganizationProvisioningArtifacts } from "./organizationProvisioning";
import { persistOrganizationProvisioningState } from "./organizationProvisioningPersistence";
import type { ProvisionedStatePrimer } from "./provisionedStatePrimer";
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
    initialOrganizationProfileDocument: ProvisionedDocumentRequest | undefined,
    initialSystemContainers: ProvisionedSystemContainerRequest[] | undefined,
    acceptedLegalTermsVersion: RegistrationRequest["acceptedLegalTermsVersion"],
  ): Promise<RegistrationResponse | null>;
  /**
   * The last failure recorded for a request, which tells a refused legal
   * terms revision from any other failed registration.
   */
  getRequestFailure?(
    request: typeof REGISTRATION_REQUEST,
  ): RegistrationRequestFailure | null;
}

export interface RegisterIdentityInput {
  /**
   * The legal terms revision the user agreed to before registering (see
   * `LEGAL_TERMS_VERSION` in `@tearleads/validators/legalTerms`). The API
   * registers only the current revision and records it on the identity.
   */
  acceptedLegalTermsVersion: string;
  identityTrustDomain: string;
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
  /** Seeds what the committed bootstrap already proves. */
  primeProvisionedState?: ProvisionedStatePrimer | undefined;
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

/**
 * Submits the registration. A refusal of the legal terms revision it carries
 * throws {@link LegalTermsOutdatedError}; any other failure resolves null.
 */
async function submitRegistration(
  input: RegisterIdentityInput,
  newUserId: string,
  artifacts: Awaited<ReturnType<typeof buildOrganizationProvisioningArtifacts>>,
): Promise<RegistrationResponse | null> {
  const earlierFailure =
    input.apiClient.getRequestFailure?.(REGISTRATION_REQUEST) ?? null;
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
    input.acceptedLegalTermsVersion,
  );
  if (response) return response;
  const failure =
    input.apiClient.getRequestFailure?.(REGISTRATION_REQUEST) ?? null;
  if (isLegalTermsOutdatedFailure(failure, earlierFailure)) {
    throw new LegalTermsOutdatedError(input.acceptedLegalTermsVersion);
  }
  return null;
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
    organizationId: await deriveRegistrationOrganizationId(input.containerId),
    identityTrustDomain: input.identityTrustDomain,
    encapsulationKeyPair: input.encapsulationKeyPair,
    organizationProfileName: input.organizationProfileName,
    provisionedSystemContainers: input.provisionedSystemContainers,
    rootContainerId: input.containerId,
    rosterProfileNickname: input.rosterProfileNickname,
    signingKeyPair: input.signingKeyPair,
    userId: newUserId,
  });

  if (input.isIdentityCurrent?.() === false) return null;
  const response = await submitRegistration(input, newUserId, artifacts);
  if (!response) return null;
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
    commitLsn: response.commitLsn,
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
    primeProvisionedState: input.primeProvisionedState,
    response,
    rootContainer: artifacts.rootContainer,
    rootMetadataDocument: artifacts.rootMetadataDocument,
    rootMetadataDocumentRequest: artifacts.rootMetadataDocumentRequest,
    rosterProfileBootstrap: artifacts.rosterProfileBootstrap,
    systemContainerBootstraps: artifacts.systemContainerBootstraps,
  });

  return response;
}
