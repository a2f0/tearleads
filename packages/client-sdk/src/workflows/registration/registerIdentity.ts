import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
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
  PrincipalPolicyBundleResponse,
  RegistrationResponse,
} from "@tearleads/validators/response";
import { createInitializedContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
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
  buildInitialGroupPolicyRequest,
  buildInitialMemberGroupPolicyRequest,
} from "../organizations/principalPolicy";
import {
  deriveOrganizationRosterProfileContainerSystemSlot,
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
  ): Promise<RegistrationResponse | null>;
}

interface RegistrationPrincipalPolicies {
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"];
  newUserId: string;
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
type InitialRosterProfileContainerCreatePlan = {
  containerKey: Uint8Array;
  plan: Awaited<ReturnType<typeof buildContainerCreatePlan>>;
};

interface InitialRosterProfileBootstrap {
  containerId: string;
  containerMetadataDocument: Awaited<
    ReturnType<typeof buildMaterializedDocumentCreatePlan>
  >;
  containerMetadataInitialUpdate: Uint8Array;
  containerPlan: InitialRosterProfileContainerCreatePlan;
  containerRequest: ContainerCreateWithMetadataDocumentRequest;
  profileDocumentRequest: DocumentCreateRequest;
  systemSlot: ContainerSystemSlot;
}

export interface RegisterIdentityInput {
  apiClient: RegistrationApi;
  containerId: string;
  dbClient?: ExecSqlClientLike | null | undefined;
  encapsulationKeyPair: EncapsulationKeyPair;
  log?: ((message: string) => void) | undefined;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
  signingKeyPair: SigningKeyPair;
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

async function persistLocalRegistrationState(input: {
  bootstrap: Awaited<ReturnType<typeof createInitialRootMetadataBootstrap>>;
  containerId: string;
  dbClient?: ExecSqlClientLike | null | undefined;
  encapsulationPublicKey: Uint8Array;
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  log?: ((message: string) => void) | undefined;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
  response: RegistrationResponse;
  rootMetadataDocument: InitialRootMetadataDocument;
  rosterProfileBootstrap: InitialRosterProfileBootstrap;
}): Promise<void> {
  if (!input.dbClient) {
    return;
  }

  try {
    await persistRegistrationBootstrap(input.dbClient, {
      containerId: input.containerId,
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
      ...(input.response.rosterProfileContainer
        ? {
            rosterProfileContainer: {
              accessEpoch:
                input.response.rosterProfileContainer.container.manifestHead
                  .epoch,
              accessStateHash:
                input.response.rosterProfileContainer.container.manifestHead
                  .manifestHash,
              containerId: input.rosterProfileBootstrap.containerId,
              createdAt:
                input.response.rosterProfileContainer.container.createdAt,
              metadataDocumentId:
                input.response.rosterProfileContainer.metadataDocument.id,
              metadataInitialUpdate:
                input.rosterProfileBootstrap.containerMetadataInitialUpdate,
              metadataSnapshot: bytesToBase64(
                input.rosterProfileBootstrap.containerMetadataInitialUpdate,
              ),
              metadataState: persistedDocumentCreateStateFromResponse(
                input.rosterProfileBootstrap.containerMetadataDocument.plan,
                input.response.rosterProfileContainer.metadataDocument,
              ),
              systemSlot: input.rosterProfileBootstrap.systemSlot,
              updatedAt:
                input.response.rosterProfileContainer.container.updatedAt,
            },
          }
        : {}),
      userId: input.response.userId,
    });
    input.log?.("Local identity and root container persisted");
  } catch (error: unknown) {
    if (input.logError) {
      input.logError("Failed to persist registration data", error);
    } else {
      console.error("Failed to persist registration data:", error);
    }

    throw error;
  }
}

async function createRegistrationPrincipalPolicies(input: {
  encapsulationKeyPair: EncapsulationKeyPair;
  signingKeyPair: SigningKeyPair;
}): Promise<RegistrationPrincipalPolicies> {
  const newUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    input.signingKeyPair.signingPublicKey,
  );
  const initialAdminGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: input.encapsulationKeyPair,
    groupId: crypto.randomUUID(),
    name: "Admins",
    signerUserId: newUserId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const initialMemberGroup = await buildInitialMemberGroupPolicyRequest({
    adminGroup: initialAdminGroup,
    creatorEncapsulationKeyPair: input.encapsulationKeyPair,
    groupId: crypto.randomUUID(),
    signerUserId: newUserId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const initialOrganizationPolicy = await buildInitialOrganizationPolicyRequest(
    {
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
      organizationId,
      signingKeyPair: input.signingKeyPair,
      userId: newUserId,
    },
  );

  return {
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    newUserId,
    organizationId,
    signingFingerprint,
  };
}

async function buildInitialRosterProfileBootstrap(input: {
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  initialAdminGroup: CreateOrganizationGroupRequest;
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
  const containerPlan: InitialRosterProfileContainerCreatePlan = {
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
    profileDocumentRequest: rosterProfileDocument.plan.request,
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

  const bootstrap = await createInitialRootMetadataBootstrap(input.containerId);
  const {
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    newUserId,
    organizationId,
    signingFingerprint,
  } = await createRegistrationPrincipalPolicies({
    encapsulationKeyPair: input.encapsulationKeyPair,
    signingKeyPair: input.signingKeyPair,
  });
  const author = resolveDocumentCreateAuthor({
    auth: {
      organizationId,
      userId: newUserId,
    },
    crypto: {
      signingFingerprint,
      signingKeyPair: input.signingKeyPair,
    },
  });
  if (!author) {
    throw new Error(
      `Registration document author context is unavailable for user ${newUserId} in organization ${organizationId}.`,
    );
  }

  const rootContainer = await buildRootContainerCreatePlan({
    adminGroup: initialAdminGroup,
    author,
    containerId: input.containerId,
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
    initialAdminGroup,
    rootContainer,
    rootContainerProjection,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
  });

  const response = await input.apiClient.registerUser(
    newUserId,
    organizationId,
    input.containerId,
    input.signingKeyPair.signingPublicKey,
    input.encapsulationKeyPair.publicKey,
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    rootContainer.plan.request,
    rootMetadataDocument.plan.request,
    rosterProfileBootstrap.containerRequest,
    rosterProfileBootstrap.profileDocumentRequest,
  );
  if (!response) {
    return null;
  }

  input.log?.(`Key registered (${response.userId})`);
  await persistLocalRegistrationState({
    bootstrap,
    containerId: input.containerId,
    dbClient: input.dbClient,
    encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
    initialAdminGroup,
    initialMemberGroup,
    log: input.log,
    logError: input.logError,
    response,
    rootMetadataDocument,
    rosterProfileBootstrap,
  });

  return response;
}
