import {
  bytesToHex,
  CHALLENGE_TTL_SECONDS,
  generateChallenge,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import {
  computeAccessFingerprint,
  computeAccessStateHash,
} from "../../access/accessFingerprint";
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
  organizationMembers,
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

async function createPersonalOrganization(tx: DatabaseTransaction) {
  const [org] = await tx
    .insert(organizations)
    .values({ name: "Personal" })
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
    signingKeyBytes: Uint8Array;
  },
) {
  const [user] = await tx
    .insert(users)
    .values({
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
  return createContainerMetadataDocument(tx, {
    authorFingerprint: fingerprint,
    containerId,
    createdByFingerprint: fingerprint,
    initialMetadataUpdates: input.initialRootMetadataUpdates,
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
    const org = await createPersonalOrganization(tx);
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
      signingKeyBytes,
    });
    await tx.insert(organizationMembers).values({
      organizationId: org.id,
      userId: user.id,
      role: "owner",
    });
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

    return {
      userId: user.id,
      organizationId: org.id,
      rootContainerId: container.id,
      rootMetadataAccessEpoch: rootMetadata.metadataAccessEpoch,
      rootMetadataDocumentId: rootMetadata.metadataDocumentId,
      rootMetadataRecipientEncapsulationPublicKeys:
        rootMetadata.metadataRecipientEncapsulationPublicKeys,
    };
  });
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
  const result = await runRegisterPublicKeyTransaction(
    runtime,
    input,
    fingerprint,
    encapsulationFingerprint,
    signingKeyBytes,
    encapsulationKeyBytes,
  );
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
    rootMetadataRecipientEncapsulationPublicKeys:
      result.rootMetadataRecipientEncapsulationPublicKeys,
    challenge: challengeHex,
  };
}

export function isDuplicateRegisterFingerprintError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === DUPLICATE_FINGERPRINT_ERROR
  );
}

export { ContainerMetadataError };
