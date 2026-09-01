import type { EncapsulationKeyPair, SigningKeyPair } from "@symcrypt/crypto";
import type { CreateOrganizationRequest } from "@symcrypt/validators/request";
import type { CreateOrganizationResponse } from "@symcrypt/validators/response";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import type { ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import {
  buildOrganizationProvisioningArtifacts,
  type OrganizationProvisioningArtifacts,
  type OrganizationProvisioningArtifactsInput,
  type ProvisionedSystemContainerSpec,
  persistOrganizationProvisioningState,
} from "../registration/registerIdentity";

import {
  makeOrganizationProvisioningAttemptDurable,
  removeNativeSubscriptionRestoreProvisioningAttempt,
} from "./organizationProvisioningAttempt";

export { removeNativeSubscriptionRestoreProvisioningAttempt };

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
  /** @internal Forwarded to the bootstrap persist; test-only seam. */
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
  /** Purged organization whose personal-org generation this replaces. */
  replacesOrganizationId?: string | undefined;
  /** Marks and durably replays a fresh native-subscription restore target. */
  nativeSubscriptionRestore?: boolean | undefined;
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

function isAdoptedReplacementResponse(input: {
  creation: CreateOrganizationInput;
  request: CreateOrganizationRequest;
  response: CreateOrganizationResponse;
}): boolean {
  if (
    input.response.organizationId === input.request.organizationId &&
    input.response.rootContainerId === input.request.rootContainerId
  ) {
    return false;
  }
  if (
    !input.creation.replacesOrganizationId ||
    input.response.userId !== input.creation.userId
  ) {
    throw new Error(
      "Organization provisioning returned an unexpected organization",
    );
  }
  input.creation.log?.(
    `Organization replacement adopted (${input.response.organizationId})`,
  );
  return true;
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
  const candidateArtifacts: OrganizationProvisioningArtifacts =
    await buildOrganizationProvisioningArtifacts(artifactsInput);

  if (
    input.replacesOrganizationId &&
    input.isIdentityCurrent &&
    !input.isIdentityCurrent()
  ) {
    input.log?.(
      "Organization creation aborted: identity changed while building artifacts",
    );
    return null;
  }

  const durableAttempt = await makeOrganizationProvisioningAttemptDurable({
    artifacts: candidateArtifacts,
    canStartDurableMutation: input.isIdentityCurrent,
    dbClient: input.dbClient,
    nativeSubscriptionRestore: input.nativeSubscriptionRestore,
    replacesOrganizationId: input.replacesOrganizationId,
    rootContainerId,
    userId: input.userId,
  });
  if (!durableAttempt) {
    input.log?.(
      "Organization creation aborted: identity changed before saving artifacts",
    );
    return null;
  }
  const {
    artifacts,
    request,
    rootContainerId: durableRootContainerId,
  } = durableAttempt;

  if (input.isIdentityCurrent && !input.isIdentityCurrent()) {
    input.log?.(
      "Organization creation aborted: identity changed before provisioning",
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

  if (isAdoptedReplacementResponse({ creation: input, request, response })) {
    // Another device won the serialized replacement race. Its encrypted
    // bootstrap is server-authoritative and will hydrate normally; persisting
    // this device's losing candidate would instead create an unrelated local
    // root. The session reset rebinds retained local data to the winning ids.
    return response;
  }

  input.log?.(`Organization created (${response.organizationId})`);
  await persistOrganizationProvisioningState({
    bootstrap: artifacts.bootstrap,
    canStartDurableMutation: input.isIdentityCurrent,
    onPersistQueued: input.onPersistQueued,
    containerId: durableRootContainerId,
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
