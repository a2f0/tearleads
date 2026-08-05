import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  type SigningKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type {
  CreateOrganizationGroupRequest,
  ProvisionedDocumentRequest,
  ProvisionedSystemContainerRequest,
  RegistrationRequest,
} from "@tearleads/validators/request";
import type { RegistrationResponse } from "@tearleads/validators/response";
import { createInitializedContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import { deriveStableDocumentId } from "../../data/documents/shared/stableDocumentId";
import { encodeOrganizationAuthorityDescriptor } from "../../data/organizationAuthorityDescriptor";
import type { ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import type { LocalUserIdentityCandidate } from "../../data/trustedUserIdentity";
import {
  type ContainerSystemSlotDefinition,
  deriveContainerSystemSlot,
} from "../container-contents/systemSlot";
import {
  buildContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../containers/child/create";
import {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "../containers/root/create";
import { resolveDocumentCreateAuthor } from "../documents/author";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";
import { buildInitialDocumentSyncRequest } from "../documents/initialSync";
import { getOrganizationProfileDocumentLocalId } from "../organizations/organizationProfile";
import {
  buildInitialGroupPolicyRequest,
  buildInitialMemberGroupPolicyRequest,
} from "../organizations/principalPolicy";
import {
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationRosterProfileContainerSystemSlot,
  getRosterProfileDocumentLocalId,
  ORGANIZATION_METADATA_CONTAINER_NAME,
  ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
} from "../organizations/rosterProfileContainer";
import type {
  InitialOrganizationMetadataBootstrap,
  InitialRootContainerCreatePlan,
  InitialRosterProfileBootstrap,
  InitialSystemContainerBootstrap,
  InitialSystemContainerCreatePlan,
  OrganizationProvisioningArtifacts,
} from "./organizationProvisioningArtifacts";
import { persistOrganizationProvisioningState } from "./organizationProvisioningPersistence";
import {
  buildProvisionedOrganizationProfile,
  buildProvisionedRosterProfile,
} from "./provisionedProfileDocument";
import { verifiedPrincipalPolicyFromInitialGroupRequest } from "./registrationPrincipalPolicyPersistence";
import { createInitialRootMetadataBootstrap } from "./rootMetadataBootstrap";

export type { OrganizationProvisioningArtifacts } from "./organizationProvisioningArtifacts";
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

type InitialRootContainerProjection = ReturnType<
  typeof rootContainerWriterProjectionFromCreatePlan
>;

/**
 * An app-owned system container to provision atomically with a new organization
 * (e.g. a trash bin). The client-sdk is agnostic to what these are:
 * the caller (the app, which owns the mini-app slot namespaces) declares each
 * one, and the provisioning path derives its per-user system slot, builds a
 * signed Admins-scoped child of root, and links it into the same transaction as
 * the rest of the organization bootstrap. The behavioral rules that govern a
 * system container are resolved client-side by slot, so provisioning needs only
 * the slot definition, display name, and icon — no rules travel to the server.
 */
export interface ProvisionedSystemContainerSpec {
  readonly slotDefinition: ContainerSystemSlotDefinition;
  readonly name: string;
  readonly icon: string | null;
}

interface InitialOrganizationMetadataBootstrapInput {
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  organizationProfileName?: string | undefined;
  rootContainer: InitialRootContainerCreatePlan;
  rootContainerProjection: InitialRootContainerProjection;
  targetSecretKey: Uint8Array;
}

interface InitialRosterProfileInput {
  author: InitialOrganizationMetadataBootstrapInput["author"];
  containerProjection: ReturnType<
    typeof childContainerWriterProjectionFromCreatePlan
  >;
  encapsulationPublicKey: Uint8Array;
  knownContainerKeks: ReadonlyMap<string, Uint8Array>;
  rosterProfileNickname?: string | undefined;
  targetSecretKey: Uint8Array;
}

export interface RegisterIdentityInput {
  apiClient: RegistrationApi;
  containerId: string;
  dbClient: ExecSqlClientLike;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
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
    version: 1,
    organizationId: input.organizationId,
    adminGroupId: input.adminGroupId,
    memberGroupId: input.memberGroupId,
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
    memberEnvelopes,
  };
}

async function createOrganizationPrincipalPolicies(input: {
  encapsulationKeyPair: EncapsulationKeyPair;
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
    name: "Admins",
    signerUserId: input.userId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const initialMemberGroup = await buildInitialMemberGroupPolicyRequest({
    creatorEncapsulationKeyPair: input.encapsulationKeyPair,
    groupId: crypto.randomUUID(),
    signerUserId: input.userId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const initialOrganizationPolicy = await buildInitialOrganizationPolicyRequest(
    {
      adminGroupId: initialAdminGroup.groupId,
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
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

/** Builds the signed artifacts shared by registration and org creation. */
export async function buildOrganizationProvisioningArtifacts(
  input: OrganizationProvisioningArtifactsInput,
): Promise<OrganizationProvisioningArtifacts> {
  const bootstrap = await createInitialRootMetadataBootstrap(
    input.rootContainerId,
  );
  const {
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    organizationId,
    signingFingerprint,
  } = await createOrganizationPrincipalPolicies({
    encapsulationKeyPair: input.encapsulationKeyPair,
    signingKeyPair: input.signingKeyPair,
    userId: input.userId,
  });
  const author = resolveDocumentCreateAuthor({
    auth: { organizationId, userId: input.userId },
    crypto: { signingFingerprint, signingKeyPair: input.signingKeyPair },
  });
  if (!author) {
    throw new Error(
      `Organization provisioning document author context is unavailable for user ${input.userId} in organization ${organizationId}.`,
    );
  }

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

interface ProvisionedChildContainerCore {
  containerId: string;
  containerMetadataDocument: Awaited<
    ReturnType<typeof buildMaterializedDocumentCreatePlan>
  >;
  containerMetadataInitialUpdate: Uint8Array;
  containerPlan: InitialSystemContainerCreatePlan;
  containerProjection: ReturnType<
    typeof childContainerWriterProjectionFromCreatePlan
  >;
  containerRequest: {
    systemSlot: ContainerSystemSlot;
    container: InitialSystemContainerCreatePlan["plan"]["request"];
    initialMetadataSync: Awaited<
      ReturnType<typeof buildInitialDocumentSyncRequest>
    >;
    metadataDocument: Awaited<
      ReturnType<typeof buildMaterializedDocumentCreatePlan>
    >["plan"]["request"];
  };
  knownContainerKeks: ReadonlyMap<string, Uint8Array>;
  systemSlot: ContainerSystemSlot;
}

/**
 * The shared spine of every provisioned system child container: mint the
 * container and its metadata document under root, project the writer view,
 * and assemble the create request. Callers differ only in slot derivation,
 * display metadata, authorizing policies, an optional managed read grant, and
 * what they attach afterwards (roster/org profile documents).
 */
async function buildProvisionedChildContainerCore(input: {
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  icon: string | null;
  managedPrincipalGrant?: Parameters<
    typeof buildContainerCreatePlan
  >[0]["managedPrincipalGrant"];
  name: string;
  principalPolicies: Parameters<
    typeof buildContainerCreatePlan
  >[0]["principalPolicies"];
  rootContainer: InitialRootContainerCreatePlan;
  rootContainerProjection: InitialRootContainerProjection;
  systemSlot: ContainerSystemSlot;
  targetSecretKey: Uint8Array;
}): Promise<ProvisionedChildContainerCore> {
  const containerId = crypto.randomUUID();
  const { initialUpdate } = await createInitializedContainerMetadataDocument(
    containerId,
    {
      icon: input.icon,
      name: input.name,
    },
  );
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const containerPlan: InitialSystemContainerCreatePlan = {
    containerKey,
    plan: await buildContainerCreatePlan({
      author: input.author,
      containerId,
      containerKey,
      ...(input.managedPrincipalGrant
        ? { managedPrincipalGrant: input.managedPrincipalGrant }
        : {}),
      metadataDocumentId: containerId,
      parentKekMaterial: input.rootContainer.containerKey,
      parentProjection: input.rootContainerProjection,
      principalPolicies: input.principalPolicies,
    }),
  };
  const containerProjection = childContainerWriterProjectionFromCreatePlan({
    materializedPlan: containerPlan,
    parentProjection: input.rootContainerProjection,
  });
  const knownContainerKeks = new Map([
    [containerPlan.plan.containerKeyEpochId, containerPlan.containerKey],
  ]);
  const containerMetadataDocument = await buildMaterializedDocumentCreatePlan({
    author: input.author,
    containerProjection,
    documentId: containerPlan.plan.metadataDocumentId,
    knownContainerKeks,
    targetSecretKey: input.targetSecretKey,
    trustedLocalProjection: true,
  });
  const initialMetadataSync = await buildInitialDocumentSyncRequest({
    author: input.author,
    containerProjection,
    initialUpdate,
    materializedDocument: containerMetadataDocument,
  });
  return {
    containerId,
    containerMetadataDocument,
    containerMetadataInitialUpdate: initialUpdate,
    containerPlan,
    containerProjection,
    containerRequest: {
      systemSlot: input.systemSlot,
      container: containerPlan.plan.request,
      initialMetadataSync,
      metadataDocument: containerMetadataDocument.plan.request,
    },
    knownContainerKeks,
    systemSlot: input.systemSlot,
  };
}

async function buildInitialRosterProfileBootstrap(input: {
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  encapsulationPublicKey: Uint8Array;
  initialAdminGroup: CreateOrganizationGroupRequest;
  rosterProfileNickname?: string | undefined;
  rootContainer: InitialRootContainerCreatePlan;
  rootContainerProjection: InitialRootContainerProjection;
  targetSecretKey: Uint8Array;
}): Promise<InitialRosterProfileBootstrap> {
  const core = await buildProvisionedChildContainerCore({
    author: input.author,
    icon: null,
    name: ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
    principalPolicies: [
      await verifiedPrincipalPolicyFromInitialGroupRequest(
        input.initialAdminGroup,
      ),
    ],
    rootContainer: input.rootContainer,
    rootContainerProjection: input.rootContainerProjection,
    systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId: input.author.organizationId,
    }),
    targetSecretKey: input.targetSecretKey,
  });
  const { profile, rosterProfileDocument } = await buildInitialRosterProfile({
    author: input.author,
    containerProjection: core.containerProjection,
    encapsulationPublicKey: input.encapsulationPublicKey,
    knownContainerKeks: core.knownContainerKeks,
    rosterProfileNickname: input.rosterProfileNickname,
    targetSecretKey: input.targetSecretKey,
  });
  return {
    containerId: core.containerId,
    containerMetadataDocument: core.containerMetadataDocument,
    containerMetadataInitialUpdate: core.containerMetadataInitialUpdate,
    containerPlan: core.containerPlan,
    containerRequest: core.containerRequest,
    profileDocument: rosterProfileDocument,
    profileDocumentInitialUpdate: profile.initialUpdate,
    profileDocumentRequest: profile.request,
    systemSlot: core.systemSlot,
  };
}

async function buildInitialRosterProfile(input: InitialRosterProfileInput) {
  const rosterProfileDocument = await buildMaterializedDocumentCreatePlan({
    author: input.author,
    containerProjection: input.containerProjection,
    documentId: await deriveStableDocumentId(
      getRosterProfileDocumentLocalId({
        organizationId: input.author.organizationId,
        userId: input.author.signerUserId,
      }),
    ),
    knownContainerKeks: input.knownContainerKeks,
    targetSecretKey: input.targetSecretKey,
    trustedLocalProjection: true,
  });
  const profile = await buildProvisionedRosterProfile({
    author: input.author,
    containerProjection: input.containerProjection,
    encapsulationPublicKey: input.encapsulationPublicKey,
    materializedDocument: rosterProfileDocument,
    nickname: input.rosterProfileNickname,
  });
  return { profile, rosterProfileDocument };
}

async function buildInitialSystemContainerBootstrap(input: {
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  initialAdminGroup: CreateOrganizationGroupRequest;
  rootContainer: InitialRootContainerCreatePlan;
  rootContainerProjection: InitialRootContainerProjection;
  signingPrivateKey: Uint8Array;
  spec: ProvisionedSystemContainerSpec;
  targetSecretKey: Uint8Array;
}): Promise<InitialSystemContainerBootstrap> {
  const core = await buildProvisionedChildContainerCore({
    author: input.author,
    icon: input.spec.icon,
    name: input.spec.name,
    principalPolicies: [
      await verifiedPrincipalPolicyFromInitialGroupRequest(
        input.initialAdminGroup,
      ),
    ],
    rootContainer: input.rootContainer,
    rootContainerProjection: input.rootContainerProjection,
    systemSlot: await deriveContainerSystemSlot({
      definition: input.spec.slotDefinition,
      secretKey: input.signingPrivateKey,
    }),
    targetSecretKey: input.targetSecretKey,
  });
  return {
    containerId: core.containerId,
    containerMetadataDocument: core.containerMetadataDocument,
    containerMetadataInitialUpdate: core.containerMetadataInitialUpdate,
    containerPlan: core.containerPlan,
    containerRequest: core.containerRequest,
    icon: input.spec.icon,
    name: input.spec.name,
    systemSlot: core.systemSlot,
  };
}

async function referencedPrincipalHeadFromInitialGroupRequest(
  input: CreateOrganizationGroupRequest,
): Promise<ReferencedPrincipalHead> {
  return {
    principalType: "group",
    principalId: input.groupId,
    version: input.initialGroupPolicy.state.version,
    keyEpoch: input.initialGroupPolicy.state.keyEpoch,
    stateHash: await computePrincipalStateHash(input.initialGroupPolicy.state),
    keyFingerprint: input.initialGroupPolicy.state.keyFingerprint,
  };
}

function stableOrganizationProfileId(organizationId: string): Promise<string> {
  return deriveStableDocumentId(
    getOrganizationProfileDocumentLocalId({ organizationId }),
  );
}

async function buildInitialOrganizationProfile(input: {
  author: InitialOrganizationMetadataBootstrapInput["author"];
  containerProjection: ReturnType<
    typeof childContainerWriterProjectionFromCreatePlan
  >;
  knownContainerKeks: ReadonlyMap<string, Uint8Array>;
  organizationProfileName?: string | undefined;
  targetSecretKey: Uint8Array;
}) {
  const organizationProfileDocument = await buildMaterializedDocumentCreatePlan(
    {
      author: input.author,
      containerProjection: input.containerProjection,
      documentId: await stableOrganizationProfileId(
        input.author.organizationId,
      ),
      knownContainerKeks: input.knownContainerKeks,
      targetSecretKey: input.targetSecretKey,
      trustedLocalProjection: true,
    },
  );
  const profile = await buildProvisionedOrganizationProfile({
    author: input.author,
    containerProjection: input.containerProjection,
    materializedDocument: organizationProfileDocument,
    name: input.organizationProfileName,
  });
  return { organizationProfileDocument, profile };
}

/**
 * Builds the org public metadata container and links the encrypted organization
 * profile document (the display name) into it. The container is a child of root
 * born with a read grant to the reserved Members group, so every active roster
 * member can decrypt the org name via the group KEK — without gaining access to
 * the Admins-scoped roster profile container's private PII. The founder can also
 * read it by inheriting root through the Admins group.
 */
async function buildInitialOrganizationMetadataBootstrap(
  input: InitialOrganizationMetadataBootstrapInput,
): Promise<InitialOrganizationMetadataBootstrap> {
  const core = await buildProvisionedChildContainerCore({
    author: input.author,
    icon: null,
    managedPrincipalGrant: {
      accessLevel: "read",
      principalEncapsulationPublicKey:
        input.initialMemberGroup.initialGroupPolicy.state
          .encapsulationPublicKey,
      principalHead: await referencedPrincipalHeadFromInitialGroupRequest(
        input.initialMemberGroup,
      ),
    },
    name: ORGANIZATION_METADATA_CONTAINER_NAME,
    // Admins justify the parent write; Members justify the read grant.
    principalPolicies: await Promise.all([
      verifiedPrincipalPolicyFromInitialGroupRequest(input.initialAdminGroup),
      verifiedPrincipalPolicyFromInitialGroupRequest(input.initialMemberGroup),
    ]),
    rootContainer: input.rootContainer,
    rootContainerProjection: input.rootContainerProjection,
    systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: input.author.organizationId,
    }),
    targetSecretKey: input.targetSecretKey,
  });
  const { organizationProfileDocument, profile } =
    await buildInitialOrganizationProfile({
      author: input.author,
      containerProjection: core.containerProjection,
      knownContainerKeks: core.knownContainerKeks,
      organizationProfileName: input.organizationProfileName,
      targetSecretKey: input.targetSecretKey,
    });
  return {
    containerId: core.containerId,
    containerMetadataDocument: core.containerMetadataDocument,
    containerMetadataInitialUpdate: core.containerMetadataInitialUpdate,
    containerPlan: core.containerPlan,
    containerRequest: core.containerRequest,
    organizationProfileDocument,
    organizationProfileDocumentRequest: profile.request,
    organizationProfileSnapshot: profile.snapshot,
    systemSlot: core.systemSlot,
  };
}

async function buildInitialRootProvisioning(input: {
  adminGroup: CreateOrganizationGroupRequest;
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  bootstrap: Awaited<ReturnType<typeof createInitialRootMetadataBootstrap>>;
  recipientEncapsulationPublicKey: Uint8Array;
  rootContainerId: string;
  targetSecretKey: Uint8Array;
}) {
  const rootContainer = await buildRootContainerCreatePlan({
    adminGroup: input.adminGroup,
    author: input.author,
    containerId: input.rootContainerId,
    metadataDocumentId: input.bootstrap.metadataDocumentId,
    recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
  });
  const rootContainerProjection = rootContainerWriterProjectionFromCreatePlan(
    rootContainer.plan,
  );
  const rootMetadataDocument = await buildMaterializedDocumentCreatePlan({
    author: input.author,
    containerProjection: rootContainerProjection,
    documentId: input.bootstrap.metadataDocumentId,
    knownContainerKeks: new Map([
      [rootContainer.plan.containerKeyEpochId, rootContainer.containerKey],
    ]),
    targetSecretKey: input.targetSecretKey,
    trustedLocalProjection: true,
  });
  return {
    rootContainer,
    rootContainerProjection,
    rootMetadataDocument,
    rootMetadataDocumentRequest: {
      ...rootMetadataDocument.plan.request,
      initialSync: await buildInitialDocumentSyncRequest({
        author: input.author,
        containerProjection: rootContainerProjection,
        initialUpdate: input.bootstrap.initialUpdate,
        materializedDocument: rootMetadataDocument,
      }),
    },
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
