import {
  type AccessEventV2,
  type AccessManifestV2,
  bytesToHex,
  CHALLENGE_TTL_SECONDS,
  type ContainerKeyEpochV2,
  type ContainerKeyWrapV2,
  type ContainerUserRecipientKeyV2,
  generateChallenge,
  toFingerprint,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import {
  computeAccessFingerprint,
  computeAccessStateHash,
} from "../../access/accessFingerprint";
import { storeVerifiedAccessManifest } from "../../access/accessManifestStore";
import { storeVerifiedContainerKekState } from "../../access/containerKekStore";
import { replaceCurrentPrincipalMemberEnvelopes } from "../../access/principalMemberEnvelopes";
import { storeVerifiedPrincipalState } from "../../access/principalStateStore";
import { toUserPrincipalFingerprintRecipient } from "../../access/recipientPrincipals";
import type { DatabaseTransaction } from "../../adapters/postgres";
import {
  containerMetadataDocuments,
  containers,
  objectAccessEpochs,
  objectAccessGrants,
  organizations,
  users,
} from "../../schema";
import {
  createDocumentV2WithExecutor,
  DocumentV2MutationError,
} from "../documents/documentV2Mutations";
import type { ApiServiceRuntime } from "../runtime";

const CONTAINER_OBJECT_TYPE = "container";
const DUPLICATE_FINGERPRINT_ERROR = "REGISTER_DUPLICATE_FINGERPRINT";

export class RegisterPublicKeyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(message);
  }
}

async function createPersonalOrganization(
  tx: DatabaseTransaction,
  organizationId: string,
) {
  const [org] = await tx
    .insert(organizations)
    .values({ id: organizationId, name: "Personal" })
    .returning({ id: organizations.id });
  if (!org) {
    throw new Error("Failed to create organization");
  }
  return org;
}

async function createRootContainer(
  tx: DatabaseTransaction,
  rootContainerId: string,
  organizationId: string,
) {
  const [container] = await tx
    .insert(containers)
    .values({
      id: rootContainerId,
      organizationId,
      parentId: null,
    })
    .returning({ id: containers.id });
  if (!container) {
    throw new Error("Failed to create root container");
  }
  return container;
}

async function createRegisteredUser(
  tx: DatabaseTransaction,
  input: {
    encapsulationFingerprint: string;
    encapsulationKeyBytes: Uint8Array;
    fingerprint: string;
    organizationId: string;
    userId: string;
    signingKeyBytes: Uint8Array;
  },
) {
  const [user] = await tx
    .insert(users)
    .values({
      id: input.userId,
      fingerprint: input.fingerprint,
      signingPublicKey: bytesToBase64(input.signingKeyBytes),
      encapsulationPublicKey: bytesToBase64(input.encapsulationKeyBytes),
      encapsulationKeyFingerprint: input.encapsulationFingerprint,
      defaultOrganizationId: input.organizationId,
    })
    .onConflictDoNothing({ target: users.fingerprint })
    .returning({ id: users.id });
  if (!user) {
    throw new Error(DUPLICATE_FINGERPRINT_ERROR);
  }
  return user;
}

function validateInitialOrganizationPolicyInput(
  input: PublicKeyRequest,
  signingFingerprint: string,
  encapsulationFingerprint: string,
) {
  const { memberEnvelopes, projection, state } =
    input.initialOrganizationPolicy;

  if (
    state.principalType !== "organization" ||
    state.principalId !== input.organizationId
  ) {
    throw new RegisterPublicKeyError(
      "initialOrganizationPolicy state must target the registered organization",
      400,
    );
  }

  if (
    state.signerUserId !== input.userId ||
    state.signerUserKeyFingerprint !== signingFingerprint
  ) {
    throw new RegisterPublicKeyError(
      "initialOrganizationPolicy signer must match the registering user",
      400,
    );
  }

  if (
    state.version !== 1 ||
    state.prevStateHash !== null ||
    state.keyEpoch !== 1
  ) {
    throw new RegisterPublicKeyError(
      "initialOrganizationPolicy state must be the first organization state",
      400,
    );
  }

  const onlyProjectionMember = projection[0];
  if (
    projection.length !== 1 ||
    !onlyProjectionMember ||
    onlyProjectionMember.memberPrincipalType !== "user" ||
    onlyProjectionMember.memberPrincipalId !== input.userId ||
    onlyProjectionMember.role !== "admin" ||
    state.memberCount !== 1
  ) {
    throw new RegisterPublicKeyError(
      "initialOrganizationPolicy projection must contain the registering user as sole admin",
      400,
    );
  }

  const onlyMemberEnvelope = memberEnvelopes[0];
  if (
    memberEnvelopes.length !== 1 ||
    !onlyMemberEnvelope ||
    onlyMemberEnvelope.memberPrincipalType !== "user" ||
    onlyMemberEnvelope.memberPrincipalId !== input.userId ||
    onlyMemberEnvelope.memberKeyFingerprint !== encapsulationFingerprint
  ) {
    throw new RegisterPublicKeyError(
      "initialOrganizationPolicy member envelope must wrap the registering user",
      400,
    );
  }
}

async function storeInitialOrganizationPolicy(
  tx: DatabaseTransaction,
  input: PublicKeyRequest,
) {
  const storedState = await storeVerifiedPrincipalState(
    {
      state: input.initialOrganizationPolicy.state,
      encryptedPayload: input.initialOrganizationPolicy.encryptedPayload,
      projection: input.initialOrganizationPolicy.projection,
    },
    tx,
  );

  await replaceCurrentPrincipalMemberEnvelopes(
    {
      principalType: "organization",
      principalId: input.organizationId,
      stateHash: storedState.stateHash,
      envelopes: input.initialOrganizationPolicy.memberEnvelopes,
    },
    tx,
  );
}

function readInitialRootContainerV2MetadataDocumentId(
  input: PublicKeyRequest,
): string {
  const body = input.initialRootContainerV2.body;
  const metadataDocumentId =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? Reflect.get(body, "metadataDocumentId")
      : null;

  return typeof metadataDocumentId === "string" && metadataDocumentId.length > 0
    ? metadataDocumentId
    : "";
}

function requireRootV2Verification<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: Error },
): T {
  if (result.ok) {
    return result.value;
  }

  throw new RegisterPublicKeyError(result.error.message, 400);
}

async function storeInitialRootContainerV2(
  tx: DatabaseTransaction,
  input: PublicKeyRequest,
  fingerprint: string,
): Promise<{
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataDocumentId: string;
}> {
  const request = input.initialRootContainerV2;
  const metadataDocumentId =
    readInitialRootContainerV2MetadataDocumentId(input);

  const event = requireRootV2Verification(
    await verifySignedAccessEvent({
      body: request.body as Parameters<
        typeof verifySignedAccessEvent
      >[0]["body"],
      event: request.event as unknown as AccessEventV2,
      signerPublicKey: new Uint8Array(input.signingPublicKey),
    }),
  );

  if (
    event.event.eventType !== "container.create" ||
    event.event.objectKind !== "container" ||
    event.event.objectId !== input.rootContainerId ||
    event.event.organizationId !== input.organizationId ||
    event.event.signerUserId !== input.userId ||
    event.event.signerKeyFingerprint !== fingerprint
  ) {
    throw new RegisterPublicKeyError(
      "Initial root container V2 event does not match registration",
      400,
    );
  }

  const manifest = requireRootV2Verification(
    await verifyContainerAccessManifest({
      event,
      expectedManifestHash: request.expectedManifestHash,
      manifest: request.manifest as unknown as AccessManifestV2,
      parentContainerPath: [],
      previousManifest: null,
    }),
  );

  if (
    manifest.state.containerId !== input.rootContainerId ||
    manifest.state.organizationId !== input.organizationId ||
    manifest.state.parentContainerId !== null ||
    manifest.state.parentManifestHash !== null ||
    manifest.state.metadataDocumentId !== metadataDocumentId
  ) {
    throw new RegisterPublicKeyError(
      "Initial root container V2 manifest does not match registration",
      400,
    );
  }

  const kekState = requireRootV2Verification(
    await verifyContainerKekState({
      containerManifest: manifest,
      keyEpoch: request.keyEpoch as unknown as ContainerKeyEpochV2,
      userRecipientKeys: (request.userRecipientKeys ??
        []) as unknown as ContainerUserRecipientKeyV2[],
      wraps: request.wraps as unknown as ContainerKeyWrapV2[],
    }),
  );

  await storeVerifiedAccessManifest({ verifiedManifest: manifest }, tx);
  await storeVerifiedContainerKekState({ verifiedState: kekState }, tx);
  return {
    metadataAccessEpoch: manifest.state.epoch,
    metadataAccessStateHash: manifest.manifestHash,
    metadataDocumentId: manifest.state.metadataDocumentId,
  };
}

async function writeInitialRootContainerAccess(
  tx: DatabaseTransaction,
  input: {
    containerId: string;
    encapsulationFingerprint: string;
    userId: string;
  },
) {
  await tx.insert(objectAccessGrants).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: input.containerId,
    subjectType: "user",
    subjectId: input.userId,
    accessLevel: "admin",
  });

  await tx.insert(objectAccessEpochs).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: input.containerId,
    epoch: 1,
    accessFingerprint: await computeAccessFingerprint({
      objectType: CONTAINER_OBJECT_TYPE,
      ancestorContainerIds: [input.containerId],
      containerId: input.containerId,
      grants: [
        {
          objectId: input.containerId,
          subjectType: "user",
          subjectId: input.userId,
          accessLevel: "admin",
        },
      ],
      recipients: [
        toUserPrincipalFingerprintRecipient({
          userId: input.userId,
          accessLevel: "admin",
          keyFingerprint: input.encapsulationFingerprint,
        }),
      ],
    }),
    accessStateHash: await computeAccessStateHash({
      objectType: CONTAINER_OBJECT_TYPE,
      ancestorContainerIds: [input.containerId],
      containerId: input.containerId,
      grants: [
        {
          objectId: input.containerId,
          subjectType: "user",
          subjectId: input.userId,
          accessLevel: "admin",
        },
      ],
      referencedPrincipals: [],
    }),
    updatedAt: new Date(),
  });
}

function readInitialRootMetadataDocumentV2Id(input: PublicKeyRequest): string {
  const event = input.initialRootMetadataDocumentV2.event;
  const documentId = Reflect.get(event, "objectId");

  return typeof documentId === "string" && documentId.length > 0
    ? documentId
    : "";
}

async function createInitialRootMetadataDocumentV2(
  tx: DatabaseTransaction,
  input: PublicKeyRequest,
  fingerprint: string,
  rootMetadata: {
    metadataDocumentId: string;
  },
) {
  const requestDocumentId = readInitialRootMetadataDocumentV2Id(input);
  if (requestDocumentId !== rootMetadata.metadataDocumentId) {
    throw new RegisterPublicKeyError(
      "Initial root metadata V2 document does not match root container metadata",
      400,
    );
  }

  const created = await createDocumentV2WithExecutor({
    executor: tx,
    fingerprint,
    request: input.initialRootMetadataDocumentV2,
    userId: input.userId,
  });
  if (created.id !== rootMetadata.metadataDocumentId) {
    throw new RegisterPublicKeyError(
      "Initial root metadata V2 response does not match root container metadata",
      400,
    );
  }

  await tx.insert(containerMetadataDocuments).values({
    containerId: input.rootContainerId,
    documentId: created.id,
  });

  return created;
}

async function issueRegistrationChallenge(
  runtime: ApiServiceRuntime,
  fingerprint: string,
  signingKeyBytes: Uint8Array,
) {
  await runtime.keyValueStore.set(fingerprint, bytesToBase64(signingKeyBytes));

  const challengeBytes = generateChallenge();
  const challengeHex = bytesToHex(challengeBytes);
  await runtime.keyValueStore.set(
    `challenge:${fingerprint}`,
    challengeHex,
    CHALLENGE_TTL_SECONDS,
  );
  return challengeHex;
}

async function runRegisterPublicKeyTransaction(
  runtime: ApiServiceRuntime,
  input: PublicKeyRequest,
  fingerprint: string,
  encapsulationFingerprint: string,
  signingKeyBytes: Uint8Array,
  encapsulationKeyBytes: Uint8Array,
) {
  return runtime.db.transaction(async (tx) => {
    const org = await createPersonalOrganization(tx, input.organizationId);
    const container = await createRootContainer(
      tx,
      input.rootContainerId,
      org.id,
    );
    const user = await createRegisteredUser(tx, {
      encapsulationFingerprint,
      encapsulationKeyBytes,
      fingerprint,
      organizationId: org.id,
      userId: input.userId,
      signingKeyBytes,
    });
    await storeInitialOrganizationPolicy(tx, input);
    await writeInitialRootContainerAccess(tx, {
      containerId: container.id,
      encapsulationFingerprint,
      userId: user.id,
    });
    const rootMetadata = await storeInitialRootContainerV2(
      tx,
      input,
      fingerprint,
    );
    const rootMetadataDocumentV2 = await createInitialRootMetadataDocumentV2(
      tx,
      input,
      fingerprint,
      rootMetadata,
    );

    return {
      userId: user.id,
      organizationId: org.id,
      rootContainerId: container.id,
      rootMetadataAccessEpoch: rootMetadata.metadataAccessEpoch,
      rootMetadataAccessStateHash: rootMetadata.metadataAccessStateHash,
      rootMetadataDocumentId: rootMetadata.metadataDocumentId,
      rootMetadataDocumentV2,
    };
  });
}

function toRegisterPrincipalPolicyError(
  error: unknown,
): RegisterPublicKeyError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (
    error.message === "Invalid principal state signature" ||
    error.message.startsWith("Principal state ") ||
    error.message.startsWith("Principal member envelope") ||
    error.message.startsWith("Principal member envelopes") ||
    error.message === "Principal epoch key conflict"
  ) {
    return new RegisterPublicKeyError(error.message, 400);
  }

  if (error instanceof DocumentV2MutationError) {
    return new RegisterPublicKeyError(error.message, error.status);
  }

  return null;
}

export async function registerPublicKey(
  runtime: ApiServiceRuntime,
  input: PublicKeyRequest,
): Promise<PublicKeyResponse> {
  const signingKeyBytes = new Uint8Array(input.signingPublicKey);
  const encapsulationKeyBytes = new Uint8Array(input.encapsulationPublicKey);
  const fingerprint = await toFingerprint(signingKeyBytes);
  const encapsulationFingerprint = await toFingerprint(encapsulationKeyBytes);
  validateInitialOrganizationPolicyInput(
    input,
    fingerprint,
    encapsulationFingerprint,
  );
  let result: Awaited<ReturnType<typeof runRegisterPublicKeyTransaction>>;
  try {
    result = await runRegisterPublicKeyTransaction(
      runtime,
      input,
      fingerprint,
      encapsulationFingerprint,
      signingKeyBytes,
      encapsulationKeyBytes,
    );
  } catch (error) {
    const registerPrincipalPolicyError = toRegisterPrincipalPolicyError(error);
    if (registerPrincipalPolicyError) {
      throw registerPrincipalPolicyError;
    }
    throw error;
  }
  const challengeHex = await issueRegistrationChallenge(
    runtime,
    fingerprint,
    signingKeyBytes,
  );

  await runtime.eventPublisher.publish({
    type: "user_registered",
    userId: result.userId,
    fingerprint,
  });

  return {
    message: "ok",
    userId: result.userId,
    organizationId: result.organizationId,
    rootContainerId: result.rootContainerId,
    rootMetadataDocumentId: result.rootMetadataDocumentId,
    rootMetadataAccessEpoch: result.rootMetadataAccessEpoch,
    rootMetadataAccessStateHash: result.rootMetadataAccessStateHash,
    rootMetadataDocumentV2: result.rootMetadataDocumentV2,
    challenge: challengeHex,
  };
}

export function isDuplicateRegisterFingerprintError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === DUPLICATE_FINGERPRINT_ERROR
  );
}
