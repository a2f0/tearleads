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
import {
  toUserPrincipalEnvelopeRecipient,
  toUserPrincipalFingerprintRecipient,
} from "../../access/recipientPrincipals";
import type { DatabaseTransaction } from "../../adapters/postgres";
import {
  containers,
  objectAccessEpochs,
  objectAccessGrants,
  objectRecipientEnvelopes,
  organizations,
  users,
} from "../../schema";
import {
  ContainerMetadataError,
  createContainerMetadataDocument,
} from "../containers/containerMetadata";
import type { ApiServiceRuntime } from "../runtime";

const CONTAINER_OBJECT_TYPE = "container";
const DUPLICATE_FINGERPRINT_ERROR = "REGISTER_DUPLICATE_FINGERPRINT";
const ML_KEM1024_CIPHERTEXT_LENGTH = 1568;
const WRAPPED_DEK_LENGTH = 48;

export class RegisterPublicKeyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
  }
}

async function validateWrappedDekEnvelope(
  input: PublicKeyRequest,
  encapsulationFingerprint: string,
) {
  if (input.wrappedDekEnvelope.keyFingerprint !== encapsulationFingerprint) {
    throw new RegisterPublicKeyError(
      "wrappedDekEnvelope.keyFingerprint does not match encapsulationPublicKey",
      400,
    );
  }

  if (
    input.wrappedDekEnvelope.kemCipherText.length !==
    ML_KEM1024_CIPHERTEXT_LENGTH
  ) {
    throw new RegisterPublicKeyError(
      "Invalid wrappedDekEnvelope.kemCipherText length",
      400,
    );
  }

  if (input.wrappedDekEnvelope.wrappedKey.length !== WRAPPED_DEK_LENGTH) {
    throw new RegisterPublicKeyError(
      "Invalid wrappedDekEnvelope.wrappedKey length",
      400,
    );
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
): string | undefined {
  const body = input.initialRootContainerV2?.body as
    | Record<string, unknown>
    | undefined;
  const metadataDocumentId = body
    ? Reflect.get(body, "metadataDocumentId")
    : undefined;

  return typeof metadataDocumentId === "string" && metadataDocumentId.length > 0
    ? metadataDocumentId
    : undefined;
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
  metadataDocumentId: string,
) {
  const request = input.initialRootContainerV2;
  if (!request) {
    return;
  }

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
}

async function writeInitialRootContainerAccess(
  tx: DatabaseTransaction,
  input: {
    containerId: string;
    userId: string;
    wrappedDekEnvelope: PublicKeyRequest["wrappedDekEnvelope"];
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
          keyFingerprint: input.wrappedDekEnvelope.keyFingerprint,
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

  const principalRecipient = toUserPrincipalEnvelopeRecipient({
    userId: input.userId,
    keyFingerprint: input.wrappedDekEnvelope.keyFingerprint,
  });
  await tx.insert(objectRecipientEnvelopes).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: input.containerId,
    epoch: 1,
    recipientPrincipalType: principalRecipient.principalType,
    recipientPrincipalId: principalRecipient.principalId,
    recipientKeyFingerprint: input.wrappedDekEnvelope.keyFingerprint,
    kemCipherText: bytesToBase64(
      new Uint8Array(input.wrappedDekEnvelope.kemCipherText),
    ),
    wrappedKey: bytesToBase64(
      new Uint8Array(input.wrappedDekEnvelope.wrappedKey),
    ),
  });
}

async function createInitialRootMetadata(
  tx: DatabaseTransaction,
  input: PublicKeyRequest,
  containerId: string,
  fingerprint: string,
) {
  const metadataDocumentId =
    readInitialRootContainerV2MetadataDocumentId(input);

  return createContainerMetadataDocument(tx, {
    authorFingerprint: fingerprint,
    containerId,
    createdByFingerprint: fingerprint,
    initialMetadataUpdates: input.initialRootMetadataUpdates,
    ...(metadataDocumentId === undefined ? {} : { metadataDocumentId }),
    ...(input.initialRootMetadataRecipientEnvelopes
      ? {
          initialMetadataRecipientEnvelopes:
            input.initialRootMetadataRecipientEnvelopes,
        }
      : {}),
  });
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
      userId: user.id,
      wrappedDekEnvelope: input.wrappedDekEnvelope,
    });
    const rootMetadata = await createInitialRootMetadata(
      tx,
      input,
      container.id,
      fingerprint,
    );
    await storeInitialRootContainerV2(
      tx,
      input,
      fingerprint,
      rootMetadata.metadataDocumentId,
    );

    return {
      userId: user.id,
      organizationId: org.id,
      rootContainerId: container.id,
      rootMetadataAccessEpoch: rootMetadata.metadataAccessEpoch,
      rootMetadataAccessStateHash: rootMetadata.metadataAccessStateHash,
      rootMetadataDocumentId: rootMetadata.metadataDocumentId,
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
  await validateWrappedDekEnvelope(input, encapsulationFingerprint);
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
    challenge: challengeHex,
  };
}

export function isDuplicateRegisterFingerprintError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === DUPLICATE_FINGERPRINT_ERROR
  );
}

export { ContainerMetadataError };
