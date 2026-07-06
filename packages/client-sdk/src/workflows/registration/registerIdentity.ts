import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
  type ReferencedPrincipalHead,
  type SigningKeyPair,
  signPrincipalState,
  toFingerprint,
  type VerifiedPrincipalPolicy,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type {
  ContainerCreateWithMetadataDocumentRequest,
  CreateOrganizationGroupRequest,
  DocumentCreateRequest,
  RegistrationRequest,
} from "@tearleads/validators/request";
import type {
  OrganizationProvisioningResponse,
  PrincipalPolicyBundleResponse,
  RegistrationResponse,
} from "@tearleads/validators/response";
import { createInitializedContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import { persistedDocumentCreateStateFromResponse } from "../../data/documents/shared/responses";
import type { ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
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
import {
  createInitializedOrganizationProfileDocument,
  DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
  getOrganizationProfileDocumentLocalId,
} from "../organizations/organizationProfile";
import {
  buildInitialGroupPolicyRequest,
  buildInitialMemberGroupPolicyRequest,
} from "../organizations/principalPolicy";
import {
  createInitializedRosterProfileDocument,
  DEFAULT_ROSTER_PROFILE_SELF_NICKNAME,
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationRosterProfileContainerSystemSlot,
  getRosterProfileDocumentLocalId,
  ORGANIZATION_METADATA_CONTAINER_NAME,
  ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
} from "../organizations/rosterProfileContainer";
import { persistRegistrationBootstrap } from "./persistRegistrationBootstrap";
import { createInitialRootMetadataBootstrap } from "./rootMetadataBootstrap";

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
    initialRootMetadataDocument: DocumentCreateRequest,
    initialRosterProfileContainer?:
      | ContainerCreateWithMetadataDocumentRequest
      | undefined,
    initialRosterProfileDocument?: DocumentCreateRequest | undefined,
    initialOrganizationMetadataContainer?:
      | ContainerCreateWithMetadataDocumentRequest
      | undefined,
    initialOrganizationProfileDocument?: DocumentCreateRequest | undefined,
  ): Promise<RegistrationResponse | null>;
}

interface OrganizationProvisioningPrincipalPolicies {
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"];
  organizationId: string;
  signingFingerprint: string;
}

type InitialRootMetadataDocument = Awaited<
  ReturnType<typeof buildMaterializedDocumentCreatePlan>
>;
type InitialRootContainerCreatePlan = Awaited<
  ReturnType<typeof buildRootContainerCreatePlan>
>;
type InitialRootContainerProjection = ReturnType<
  typeof rootContainerWriterProjectionFromCreatePlan
>;
type InitialSystemContainerCreatePlan = {
  containerKey: Uint8Array;
  plan: Awaited<ReturnType<typeof buildContainerCreatePlan>>;
};

interface InitialRosterProfileBootstrap {
  containerId: string;
  containerMetadataDocument: Awaited<
    ReturnType<typeof buildMaterializedDocumentCreatePlan>
  >;
  containerMetadataInitialUpdate: Uint8Array;
  containerPlan: InitialSystemContainerCreatePlan;
  containerRequest: ContainerCreateWithMetadataDocumentRequest;
  profileDocument: Awaited<
    ReturnType<typeof buildMaterializedDocumentCreatePlan>
  >;
  profileDocumentInitialUpdate: Uint8Array;
  profileDocumentRequest: DocumentCreateRequest;
  systemSlot: ContainerSystemSlot;
}

interface InitialOrganizationMetadataBootstrap {
  containerId: string;
  containerMetadataDocument: Awaited<
    ReturnType<typeof buildMaterializedDocumentCreatePlan>
  >;
  containerMetadataInitialUpdate: Uint8Array;
  containerPlan: InitialSystemContainerCreatePlan;
  containerRequest: ContainerCreateWithMetadataDocumentRequest;
  organizationProfileDocument: Awaited<
    ReturnType<typeof buildMaterializedDocumentCreatePlan>
  >;
  organizationProfileInitialUpdate: Uint8Array;
  organizationProfileSnapshot: string;
  systemSlot: ContainerSystemSlot;
}

export interface RegisterIdentityInput {
  apiClient: RegistrationApi;
  containerId: string;
  dbClient?: ExecSqlClientLike | null | undefined;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  encapsulationKeyPair: EncapsulationKeyPair;
  log?: ((message: string) => void) | undefined;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
  /**
   * Overrides the seeded personal-org profile name; defaults to {@link
   * DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME} (demo: "Peer 1's Org").
   */
  organizationProfileName?: string | undefined;
  /**
   * Overrides the seeded self roster-profile nickname; defaults to {@link
   * DEFAULT_ROSTER_PROFILE_SELF_NICKNAME} ("You"). The demo host passes each
   * pane's peer-labeled self name ("Peer 1 (You)").
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
export interface OrganizationProvisioningArtifacts {
  bootstrap: Awaited<ReturnType<typeof createInitialRootMetadataBootstrap>>;
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"];
  initialRootContainer: RegistrationRequest["initialRootContainer"];
  organizationId: string;
  organizationMetadataBootstrap: InitialOrganizationMetadataBootstrap;
  rootMetadataDocument: InitialRootMetadataDocument;
  rosterProfileBootstrap: InitialRosterProfileBootstrap;
}

export interface OrganizationProvisioningArtifactsInput {
  encapsulationKeyPair: EncapsulationKeyPair;
  organizationProfileName?: string | undefined;
  rootContainerId: string;
  rosterProfileNickname?: string | undefined;
  signingKeyPair: SigningKeyPair;
  userId: string;
}

interface PersistOrganizationProvisioningStateInput {
  bootstrap: Awaited<ReturnType<typeof createInitialRootMetadataBootstrap>>;
  containerId: string;
  dbClient?: ExecSqlClientLike | null | undefined;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  log?: ((message: string) => void) | undefined;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
  organizationMetadataBootstrap: InitialOrganizationMetadataBootstrap;
  response: OrganizationProvisioningResponse;
  rootMetadataDocument: InitialRootMetadataDocument;
  rosterProfileBootstrap: InitialRosterProfileBootstrap;
}

export async function buildInitialOrganizationPolicyRequest(input: {
  encapsulationPublicKey: Uint8Array;
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
      memberPrincipalType: "user" as const,
      memberPrincipalId: input.userId,
      role: "admin" as const,
    },
  ];
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({
        members: projection,
      }),
    ),
  );
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "organization",
      principalId: input.organizationId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
      keyFingerprint: await toFingerprint(organizationKem.publicKey),
      members: [{ principalType: "user", principalId: input.userId }],
      projection,
      payloadCiphertext,
      signedAt: new Date().toISOString(),
      signerUserId: input.userId,
      signerUserKeyFingerprint,
    }),
    input.signingKeyPair.signingPrivateKey,
  );
  const [memberEnvelope] = await wrapDekForRecipients(
    organizationKem.secretKey,
    [input.encapsulationPublicKey],
  );

  if (!memberEnvelope) {
    throw new Error("Failed to wrap organization key for registering user");
  }

  return {
    state,
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
    },
    projection,
    memberEnvelopes: [
      {
        memberPrincipalType: "user",
        memberPrincipalId: input.userId,
        memberKeyFingerprint: userEncapsulationKeyFingerprint,
        kemCipherText: bytesToBase64(memberEnvelope.kemCipherText),
        wrappedKey: bytesToBase64(memberEnvelope.wrappedKey),
      },
    ],
  };
}

export async function principalPolicyBundleFromInitialGroupRequest(
  input: CreateOrganizationGroupRequest,
): Promise<PrincipalPolicyBundleResponse> {
  const createdAt = new Date().toISOString();
  const stateHash = await computePrincipalStateHash(
    input.initialGroupPolicy.state,
  );

  return {
    currentState: {
      ...input.initialGroupPolicy.state,
      stateHash,
      createdAt,
    },
    currentPayload: {
      principalType: "group",
      principalId: input.groupId,
      stateHash,
      ...input.initialGroupPolicy.encryptedPayload,
      createdAt,
    },
    currentProjection: input.initialGroupPolicy.projection,
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: input.groupId,
      stateHash,
      epoch: input.initialGroupPolicy.state.keyEpoch,
      envelopes: input.initialGroupPolicy.memberEnvelopes,
    },
    previousStates: [],
  };
}

async function verifiedPrincipalPolicyFromInitialGroupRequest(
  input: CreateOrganizationGroupRequest,
): Promise<VerifiedPrincipalPolicy> {
  const bundle = await principalPolicyBundleFromInitialGroupRequest(input);

  return makeVerifiedPrincipalPolicy({
    principalType: "group",
    principalId: input.groupId,
    version: bundle.currentState.version,
    keyEpoch: bundle.currentState.keyEpoch,
    stateHash: bundle.currentState.stateHash,
    state: bundle.currentState,
    projection: bundle.currentProjection,
    checkpoint: {
      principalType: "group",
      principalId: input.groupId,
      version: bundle.currentState.version,
      stateHash: bundle.currentState.stateHash,
    },
  });
}

function buildOrganizationProfileRegistrationBootstrapInput(
  input: PersistOrganizationProvisioningStateInput,
):
  | Parameters<
      typeof persistRegistrationBootstrap
    >[1]["organizationProfileDocument"]
  | undefined {
  const organizationProfileDocument =
    input.response.organizationProfileDocument;
  if (!organizationProfileDocument) {
    return;
  }

  return {
    accessEpoch: 1,
    accessStateHash: organizationProfileDocument.accessManifest.manifestHash,
    containerId: input.organizationMetadataBootstrap.containerId,
    documentId: organizationProfileDocument.id,
    documentState: persistedDocumentCreateStateFromResponse(
      input.organizationMetadataBootstrap.organizationProfileDocument.plan,
      organizationProfileDocument,
    ),
    initialUpdate:
      input.organizationMetadataBootstrap.organizationProfileInitialUpdate,
    localId: getOrganizationProfileDocumentLocalId({
      organizationId: input.response.organizationId,
    }),
    snapshot: input.organizationMetadataBootstrap.organizationProfileSnapshot,
  };
}

function buildRosterProfileRegistrationBootstrapInput(
  input: PersistOrganizationProvisioningStateInput,
):
  | Parameters<typeof persistRegistrationBootstrap>[1]["rosterProfileDocument"]
  | undefined {
  const rosterProfileDocument = input.response.rosterProfileDocument;
  if (!rosterProfileDocument) {
    return;
  }

  return {
    accessEpoch: 1,
    accessStateHash: rosterProfileDocument.accessManifest.manifestHash,
    containerId: input.rosterProfileBootstrap.containerId,
    documentId: rosterProfileDocument.id,
    documentState: persistedDocumentCreateStateFromResponse(
      input.rosterProfileBootstrap.profileDocument.plan,
      rosterProfileDocument,
    ),
    initialUpdate: input.rosterProfileBootstrap.profileDocumentInitialUpdate,
    localId: getRosterProfileDocumentLocalId({
      organizationId: input.response.organizationId,
      userId: input.response.userId,
    }),
  };
}

type PersistBootstrapInput = Parameters<typeof persistRegistrationBootstrap>[1];

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

/**
 * Persists the local SQLite bootstrap (group policies, root container, roster
 * and organization profile documents) for a freshly provisioned organization.
 * Shared by registration and additional-organization creation — it reads only
 * fields common to both responses ({@link OrganizationProvisioningResponse}).
 */
export async function persistOrganizationProvisioningState(
  input: PersistOrganizationProvisioningStateInput,
): Promise<void> {
  if (!input.dbClient) {
    return;
  }

  try {
    const organizationProfileDocument =
      buildOrganizationProfileRegistrationBootstrapInput(input);
    const rosterProfileDocument =
      buildRosterProfileRegistrationBootstrapInput(input);
    const rosterProfileContainer =
      buildRosterProfileContainerBootstrapInput(input);
    const organizationMetadataContainer =
      buildOrganizationMetadataContainerBootstrapInput(input);

    await persistRegistrationBootstrap(input.dbClient, {
      containerId: input.containerId,
      documentProjectors: input.documentProjectors,
      initialAdminGroupPolicy:
        await principalPolicyBundleFromInitialGroupRequest(
          input.initialAdminGroup,
        ),
      initialMemberGroupPolicy:
        await principalPolicyBundleFromInitialGroupRequest(
          input.initialMemberGroup,
        ),
      organizationId: input.response.organizationId,
      rootMetadataAccessEpoch: input.response.rootMetadataAccessEpoch,
      rootMetadataAccessStateHash: input.response.rootMetadataAccessStateHash,
      rootMetadataDocumentId: input.response.rootMetadataDocumentId,
      rootMetadataInitialUpdate: input.bootstrap.initialUpdate,
      rootMetadataSnapshot: bytesToBase64(input.bootstrap.initialUpdate),
      rootMetadataState: persistedDocumentCreateStateFromResponse(
        input.rootMetadataDocument.plan,
        input.response.rootMetadataDocument,
      ),
      ...(rosterProfileContainer ? { rosterProfileContainer } : {}),
      ...(organizationMetadataContainer
        ? { organizationMetadataContainer }
        : {}),
      ...(organizationProfileDocument ? { organizationProfileDocument } : {}),
      ...(rosterProfileDocument ? { rosterProfileDocument } : {}),
      userId: input.response.userId,
    });
    input.log?.("Local organization bootstrap persisted");
  } catch (error: unknown) {
    if (input.logError) {
      input.logError("Failed to persist registration data", error);
    } else {
      console.error("Failed to persist registration data:", error);
    }

    throw error;
  }
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
    adminGroup: initialAdminGroup,
    creatorEncapsulationKeyPair: input.encapsulationKeyPair,
    groupId: crypto.randomUUID(),
    signerUserId: input.userId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const initialOrganizationPolicy = await buildInitialOrganizationPolicyRequest(
    {
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
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

/**
 * Builds every client-signed artifact needed to provision an organization for
 * `userId`: the admin/member group policies, the organization policy, the root
 * container and its metadata document, and the roster/organization profile
 * bootstrap. The organization id is freshly generated here. Shared verbatim by
 * {@link registerIdentity} and the additional-organization workflow.
 */
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

  const rootContainer = await buildRootContainerCreatePlan({
    adminGroup: initialAdminGroup,
    author,
    containerId: input.rootContainerId,
    metadataDocumentId: bootstrap.metadataDocumentId,
    recipientEncapsulationPublicKey: input.encapsulationKeyPair.publicKey,
  });
  const rootContainerProjection = rootContainerWriterProjectionFromCreatePlan(
    rootContainer.plan,
  );
  const rootMetadataDocument = await buildInitialRootMetadataDocument({
    author,
    bootstrap,
    rootContainer,
    rootContainerProjection,
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

  return {
    bootstrap,
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    initialRootContainer: rootContainer.plan.request,
    organizationId,
    organizationMetadataBootstrap,
    rootMetadataDocument,
    rosterProfileBootstrap,
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
  const containerId = crypto.randomUUID();
  const systemSlot = await deriveOrganizationRosterProfileContainerSystemSlot({
    organizationId: input.author.organizationId,
  });
  const { initialUpdate } = await createInitializedContainerMetadataDocument(
    containerId,
    {
      icon: null,
      name: ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
    },
  );
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const containerPlan: InitialSystemContainerCreatePlan = {
    containerKey,
    plan: await buildContainerCreatePlan({
      author: input.author,
      containerId,
      containerKey,
      metadataDocumentId: containerId,
      parentKekMaterial: input.rootContainer.containerKey,
      parentProjection: input.rootContainerProjection,
      principalPolicies: [
        await verifiedPrincipalPolicyFromInitialGroupRequest(
          input.initialAdminGroup,
        ),
      ],
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
  const rosterProfileDocument = await buildMaterializedDocumentCreatePlan({
    author: input.author,
    containerProjection,
    knownContainerKeks,
    targetSecretKey: input.targetSecretKey,
    trustedLocalProjection: true,
  });
  const rosterProfile = await createInitializedRosterProfileDocument({
    encapsulationPublicKey: bytesToBase64(input.encapsulationPublicKey),
    isSelf: true,
    nickname:
      input.rosterProfileNickname ?? DEFAULT_ROSTER_PROFILE_SELF_NICKNAME,
    userId: input.author.signerUserId,
  });
  return {
    containerId,
    containerMetadataDocument,
    containerMetadataInitialUpdate: initialUpdate,
    containerPlan,
    containerRequest: {
      systemSlot,
      container: containerPlan.plan.request,
      metadataDocument: containerMetadataDocument.plan.request,
    },
    profileDocument: rosterProfileDocument,
    profileDocumentInitialUpdate: rosterProfile.initialUpdate,
    profileDocumentRequest: rosterProfileDocument.plan.request,
    systemSlot,
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

/**
 * Builds the org public metadata container and links the encrypted organization
 * profile document (the display name) into it. The container is a child of root
 * born with a read grant to the reserved Members group, so every active roster
 * member can decrypt the org name via the group KEK — without gaining access to
 * the Admins-scoped roster profile container's private PII. The founder can also
 * read it by inheriting root through the Admins group.
 */
async function buildInitialOrganizationMetadataBootstrap(input: {
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  organizationProfileName?: string | undefined;
  rootContainer: InitialRootContainerCreatePlan;
  rootContainerProjection: InitialRootContainerProjection;
  targetSecretKey: Uint8Array;
}): Promise<InitialOrganizationMetadataBootstrap> {
  const containerId = crypto.randomUUID();
  const systemSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: input.author.organizationId,
  });
  const { initialUpdate } = await createInitializedContainerMetadataDocument(
    containerId,
    {
      icon: null,
      name: ORGANIZATION_METADATA_CONTAINER_NAME,
    },
  );
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const membersHead = await referencedPrincipalHeadFromInitialGroupRequest(
    input.initialMemberGroup,
  );
  const containerPlan: InitialSystemContainerCreatePlan = {
    containerKey,
    plan: await buildContainerCreatePlan({
      author: input.author,
      containerId,
      containerKey,
      managedPrincipalGrant: {
        accessLevel: "read",
        principalEncapsulationPublicKey:
          input.initialMemberGroup.initialGroupPolicy.state
            .encapsulationPublicKey,
        principalHead: membersHead,
      },
      metadataDocumentId: containerId,
      parentKekMaterial: input.rootContainer.containerKey,
      parentProjection: input.rootContainerProjection,
      // The Admins policy justifies writing under the root parent; the Members
      // policy justifies the read grant's KEK recipient target. The two
      // verifications are independent, so run them in parallel.
      principalPolicies: await Promise.all([
        verifiedPrincipalPolicyFromInitialGroupRequest(input.initialAdminGroup),
        verifiedPrincipalPolicyFromInitialGroupRequest(
          input.initialMemberGroup,
        ),
      ]),
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
  const organizationProfileDocument = await buildMaterializedDocumentCreatePlan(
    {
      author: input.author,
      containerProjection,
      knownContainerKeks,
      targetSecretKey: input.targetSecretKey,
      trustedLocalProjection: true,
    },
  );
  const orgProfile = await createInitializedOrganizationProfileDocument({
    name:
      input.organizationProfileName ??
      DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
  });
  return {
    containerId,
    containerMetadataDocument,
    containerMetadataInitialUpdate: initialUpdate,
    containerPlan,
    containerRequest: {
      systemSlot,
      container: containerPlan.plan.request,
      metadataDocument: containerMetadataDocument.plan.request,
    },
    organizationProfileDocument,
    organizationProfileInitialUpdate: orgProfile.initialUpdate,
    organizationProfileSnapshot: orgProfile.snapshot,
    systemSlot,
  };
}

function buildInitialRootMetadataDocument(input: {
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  bootstrap: Awaited<ReturnType<typeof createInitialRootMetadataBootstrap>>;
  rootContainer: InitialRootContainerCreatePlan;
  rootContainerProjection: InitialRootContainerProjection;
  targetSecretKey: Uint8Array;
}): Promise<InitialRootMetadataDocument> {
  return buildMaterializedDocumentCreatePlan({
    author: input.author,
    containerProjection: input.rootContainerProjection,
    documentId: input.bootstrap.metadataDocumentId,
    knownContainerKeks: new Map([
      [
        input.rootContainer.plan.containerKeyEpochId,
        input.rootContainer.containerKey,
      ],
    ]),
    targetSecretKey: input.targetSecretKey,
    trustedLocalProjection: true,
  });
}

export async function registerIdentity(
  input: RegisterIdentityInput,
): Promise<RegistrationResponse | null> {
  input.log?.("Registering identity...");

  const newUserId = crypto.randomUUID();
  const artifacts = await buildOrganizationProvisioningArtifacts({
    encapsulationKeyPair: input.encapsulationKeyPair,
    organizationProfileName: input.organizationProfileName,
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
    artifacts.rootMetadataDocument.plan.request,
    artifacts.rosterProfileBootstrap.containerRequest,
    artifacts.rosterProfileBootstrap.profileDocumentRequest,
    artifacts.organizationMetadataBootstrap.containerRequest,
    artifacts.organizationMetadataBootstrap.organizationProfileDocument.plan
      .request,
  );
  if (!response) {
    return null;
  }

  input.log?.(`Key registered (${response.userId})`);
  await persistOrganizationProvisioningState({
    bootstrap: artifacts.bootstrap,
    containerId: input.containerId,
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
