import {
  buildPrincipalStateSigningInput,
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  type SigningKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import type {
  CreateOrganizationGroupRequest,
  ProvisionedDocumentRequest,
  ProvisionedSystemContainerRequest,
  RegistrationRequest,
} from "@symcrypt/validators/request";
import type { RegistrationResponse } from "@symcrypt/validators/response";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import { encodeOrganizationAuthorityDescriptor } from "../../data/principals/organizationAuthorityDescriptor";
import type { ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import type { LocalUserIdentityCandidate } from "../../data/trustedUserIdentity";
import { resolveDocumentCreateAuthor } from "../documents/author";
import { groupPolicyMutationHead } from "../organizations/groupPolicyMutationHead";
import {
  buildInitialGroupPolicyRequest,
  buildInitialMemberGroupPolicyRequest,
} from "../organizations/principalPolicy";
import type { OrganizationProvisioningArtifacts } from "./organizationProvisioningArtifacts";
import { persistOrganizationProvisioningState } from "./organizationProvisioningPersistence";
import {
  buildInitialOrganizationMetadataBootstrap,
  buildInitialRootProvisioning,
  buildInitialRosterProfileBootstrap,
  buildInitialSystemContainerBootstrap,
  type ProvisionedSystemContainerSpec,
} from "./provisioningBootstrapBuilders";
import { createInitialRootMetadataBootstrap } from "./rootMetadataBootstrap";

export type { OrganizationProvisioningArtifacts } from "./organizationProvisioningArtifacts";
export type { ProvisionedSystemContainerSpec } from "./provisioningBootstrapBuilders";
export { persistOrganizationProvisioningState };

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
    initialRosterProfileContainer?: ProvisionedSystemContainerRequest,
    initialRosterProfileDocument?: ProvisionedDocumentRequest | undefined,
    initialOrganizationMetadataContainer?: ProvisionedSystemContainerRequest,
    initialOrganizationProfileDocument?: ProvisionedDocumentRequest | undefined,
    initialSystemContainers?: ProvisionedSystemContainerRequest[] | undefined,
  ): Promise<RegistrationResponse | null>;
}

interface OrganizationProvisioningPrincipalPolicies {
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"];
  organizationId: string;
  signingFingerprint: string;
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
  signingKeyPair: SigningKeyPair;
}

/**
 * The freshly built provisioning artifacts, shared by registration and
 * additional-organization creation. `registerIdentity` generates a new
 * `userId`; creating an additional organization reuses the caller's existing
 * one. Everything here is derived purely from the caller's key material, so it
 * is identical for both flows.
 */
export interface OrganizationProvisioningArtifactsInput {
  encapsulationKeyPair: EncapsulationKeyPair;
  organizationProfileName?: string | undefined;
  /**
   * App-owned system containers to provision atomically with the organization
   * (e.g. a trash bin). Omitted/empty leaves the org with only the roster and
   * organization-metadata system containers.
   */
  provisionedSystemContainers?:
    | ReadonlyArray<ProvisionedSystemContainerSpec>
    | undefined;
  rootContainerId: string;
  rosterProfileNickname?: string | undefined;
  signingKeyPair: SigningKeyPair;
  userId: string;
}

export async function buildInitialOrganizationPolicyRequest(input: {
  adminGroupId: string;
  groupHeads: readonly ReferencedPrincipalHead[];
  encapsulationPublicKey: Uint8Array;
  memberGroupId: string;
  organizationId: string;
  signingKeyPair: SigningKeyPair;
  userId: string;
}): Promise<RegistrationRequest["initialOrganizationPolicy"]> {
  const organizationKem = generateKemSeedAndKeyPair();
  const signerUserKeyFingerprint = await toFingerprint(
    input.signingKeyPair.signingPublicKey,
  );
  const userEncapsulationKeyFingerprint = await toFingerprint(
    input.encapsulationPublicKey,
  );
  const projection = [
    {
      userId: input.userId,
      role: "admin" as const,
    },
  ];
  const payloadCiphertext = encodeOrganizationAuthorityDescriptor({
    version: 2,
    organizationId: input.organizationId,
    adminGroupId: input.adminGroupId,
    memberGroupId: input.memberGroupId,
    groupHeads: input.groupHeads.map((head) => {
      if (head.principalType !== "group") {
        throw new Error("Organization directory can contain only group heads");
      }
      return { ...head, principalType: "group" };
    }),
  });
  const [memberEnvelope] = await wrapDekForRecipients(
    organizationKem.secretKey,
    [input.encapsulationPublicKey],
  );

  if (!memberEnvelope) {
    throw new Error("Failed to wrap organization key for registering user");
  }
  const memberEnvelopes = [
    {
      userId: input.userId,
      memberKeyFingerprint: userEncapsulationKeyFingerprint,
      kemCipherText: bytesToBase64(memberEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(memberEnvelope.wrappedKey),
    },
  ];
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "organization",
      principalId: input.organizationId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
      keyFingerprint: await toFingerprint(organizationKem.publicKey),
      members: [{ userId: input.userId }],
      memberEnvelopes,
      projection,
      grants: [],
      payloadCiphertext,
      externalAuthority: null,
      signedAt: new Date().toISOString(),
      signerUserId: input.userId,
      signerUserKeyFingerprint,
    }),
    input.signingKeyPair.signingPrivateKey,
  );

  return {
    state,
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
    },
    projection,
    grants: [],
    memberEnvelopes,
  };
}

async function createOrganizationPrincipalPolicies(input: {
  encapsulationKeyPair: EncapsulationKeyPair;
  organizationMetadataContainerId: string;
  rootContainerId: string;
  signingKeyPair: SigningKeyPair;
  userId: string;
}): Promise<OrganizationProvisioningPrincipalPolicies> {
  const organizationId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    input.signingKeyPair.signingPublicKey,
  );
  const initialAdminGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: input.encapsulationKeyPair,
    groupId: crypto.randomUUID(),
    grants: [{ containerId: input.rootContainerId, accessLevel: "admin" }],
    name: "Admins",
    signerUserId: input.userId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const initialMemberGroup = await buildInitialMemberGroupPolicyRequest({
    creatorEncapsulationKeyPair: input.encapsulationKeyPair,
    groupId: crypto.randomUUID(),
    grants: [
      {
        containerId: input.organizationMetadataContainerId,
        accessLevel: "read",
      },
    ],
    signerUserId: input.userId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const initialOrganizationPolicy = await buildInitialOrganizationPolicyRequest(
    {
      adminGroupId: initialAdminGroup.groupId,
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
      groupHeads: await Promise.all([
        groupPolicyMutationHead(initialAdminGroup.initialGroupPolicy),
        groupPolicyMutationHead(initialMemberGroup.initialGroupPolicy),
      ]),
      memberGroupId: initialMemberGroup.groupId,
      organizationId,
      signingKeyPair: input.signingKeyPair,
      userId: input.userId,
    },
  );

  return {
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    organizationId,
    signingFingerprint,
  };
}

function requireOrganizationProvisioningAuthor(input: {
  readonly organizationId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly userId: string;
}) {
  const author = resolveDocumentCreateAuthor({
    auth: { organizationId: input.organizationId, userId: input.userId },
    crypto: {
      signingFingerprint: input.signingFingerprint,
      signingKeyPair: input.signingKeyPair,
    },
  });
  if (!author) {
    throw new Error(
      `Organization provisioning document author context is unavailable for user ${input.userId} in organization ${input.organizationId}.`,
    );
  }
  return author;
}

/** Builds the signed artifacts shared by registration and org creation. */
export async function buildOrganizationProvisioningArtifacts(
  input: OrganizationProvisioningArtifactsInput,
): Promise<OrganizationProvisioningArtifacts> {
  const bootstrap = await createInitialRootMetadataBootstrap(
    input.rootContainerId,
  );
  const organizationMetadataContainerId = crypto.randomUUID();
  const {
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    organizationId,
    signingFingerprint,
  } = await createOrganizationPrincipalPolicies({
    encapsulationKeyPair: input.encapsulationKeyPair,
    organizationMetadataContainerId,
    rootContainerId: input.rootContainerId,
    signingKeyPair: input.signingKeyPair,
    userId: input.userId,
  });
  const author = requireOrganizationProvisioningAuthor({
    organizationId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
    userId: input.userId,
  });

  const {
    rootContainer,
    rootContainerProjection,
    rootMetadataDocument,
    rootMetadataDocumentRequest,
  } = await buildInitialRootProvisioning({
    adminGroup: initialAdminGroup,
    author,
    bootstrap,
    recipientEncapsulationPublicKey: input.encapsulationKeyPair.publicKey,
    rootContainerId: input.rootContainerId,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
  });
  const rosterProfileBootstrap = await buildInitialRosterProfileBootstrap({
    author,
    encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
    initialAdminGroup,
    rosterProfileNickname: input.rosterProfileNickname,
    rootContainer,
    rootContainerProjection,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
  });
  const organizationMetadataBootstrap =
    await buildInitialOrganizationMetadataBootstrap({
      author,
      containerId: organizationMetadataContainerId,
      initialAdminGroup,
      initialMemberGroup,
      organizationProfileName: input.organizationProfileName,
      rootContainer,
      rootContainerProjection,
      targetSecretKey: input.encapsulationKeyPair.secretKey,
    });
  const systemContainerBootstraps = await Promise.all(
    (input.provisionedSystemContainers ?? []).map((spec) =>
      buildInitialSystemContainerBootstrap({
        author,
        initialAdminGroup,
        rootContainer,
        rootContainerProjection,
        signingPrivateKey: input.signingKeyPair.signingPrivateKey,
        spec,
        targetSecretKey: input.encapsulationKeyPair.secretKey,
      }),
    ),
  );

  return {
    bootstrap,
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    initialRootContainer: rootContainer.plan.request,
    organizationId,
    organizationMetadataBootstrap,
    rootContainer,
    rootMetadataDocument,
    rootMetadataDocumentRequest,
    rosterProfileBootstrap,
    systemContainerBootstraps,
  };
}

export async function registerIdentity(
  input: RegisterIdentityInput,
): Promise<RegistrationResponse | null> {
  input.log?.("Registering identity...");

  const newUserId = crypto.randomUUID();
  await input.pinLocalUserIdentity(newUserId, {
    encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
    signingPublicKey: input.signingKeyPair.signingPublicKey,
  });
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
      "Registration response user does not match the locally pinned identity",
    );
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
    response,
    rootContainer: artifacts.rootContainer,
    rootMetadataDocument: artifacts.rootMetadataDocument,
    rootMetadataDocumentRequest: artifacts.rootMetadataDocumentRequest,
    rosterProfileBootstrap: artifacts.rosterProfileBootstrap,
    systemContainerBootstraps: artifacts.systemContainerBootstraps,
  });

  return response;
}
