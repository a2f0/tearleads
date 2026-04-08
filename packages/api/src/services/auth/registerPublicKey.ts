import {
  bytesToHex,
  CHALLENGE_TTL_SECONDS,
  generateChallenge,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import { computeAccessFingerprint } from "../../access/accessFingerprint";
import {
  toUserPrincipalEnvelopeRecipient,
  toUserPrincipalFingerprintRecipient,
} from "../../access/recipientPrincipals";
import {
  ContainerMetadataError,
  createContainerMetadataDocument,
} from "../../routes/containers/containerMetadata";
import {
  containers,
  objectAccessEpochs,
  objectAccessGrants,
  objectRecipientEnvelopes,
  organizationMembers,
  organizations,
  users,
} from "../../schema";
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

export async function registerPublicKey(
  runtime: ApiServiceRuntime,
  input: PublicKeyRequest,
): Promise<PublicKeyResponse> {
  const signingKeyBytes = new Uint8Array(input.signingPublicKey);
  const encapsulationKeyBytes = new Uint8Array(input.encapsulationPublicKey);
  const fingerprint = await toFingerprint(signingKeyBytes);
  const encapsulationFingerprint = await toFingerprint(encapsulationKeyBytes);

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

  const result = await runtime.db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: "Personal" })
      .returning({ id: organizations.id });

    if (!org) {
      throw new Error("Failed to create organization");
    }

    const [container] = await tx
      .insert(containers)
      .values({
        id: input.rootContainerId,
        organizationId: org.id,
        parentId: null,
      })
      .returning({ id: containers.id });

    if (!container) {
      throw new Error("Failed to create root container");
    }

    const [user] = await tx
      .insert(users)
      .values({
        fingerprint,
        signingPublicKey: bytesToBase64(signingKeyBytes),
        encapsulationPublicKey: bytesToBase64(encapsulationKeyBytes),
        encapsulationKeyFingerprint: encapsulationFingerprint,
        defaultOrganizationId: org.id,
      })
      .onConflictDoNothing({ target: users.fingerprint })
      .returning({ id: users.id });

    if (!user) {
      throw new Error(DUPLICATE_FINGERPRINT_ERROR);
    }

    await tx.insert(organizationMembers).values({
      organizationId: org.id,
      userId: user.id,
      role: "owner",
    });

    await tx.insert(objectAccessGrants).values({
      objectType: CONTAINER_OBJECT_TYPE,
      objectId: container.id,
      subjectType: "user",
      subjectId: user.id,
      accessLevel: "admin",
    });

    await tx.insert(objectAccessEpochs).values({
      objectType: CONTAINER_OBJECT_TYPE,
      objectId: container.id,
      epoch: 1,
      accessFingerprint: await computeAccessFingerprint({
        objectType: CONTAINER_OBJECT_TYPE,
        rootContainerId: container.id,
        ancestorContainerIds: [container.id],
        grants: [
          {
            objectId: container.id,
            subjectType: "user",
            subjectId: user.id,
            accessLevel: "admin",
          },
        ],
        recipients: [
          toUserPrincipalFingerprintRecipient({
            userId: user.id,
            accessLevel: "admin",
            keyFingerprint: input.wrappedDekEnvelope.keyFingerprint,
          }),
        ],
      }),
      updatedAt: new Date(),
    });

    const principalRecipient = toUserPrincipalEnvelopeRecipient({
      userId: user.id,
      keyFingerprint: input.wrappedDekEnvelope.keyFingerprint,
    });
    await tx.insert(objectRecipientEnvelopes).values({
      objectType: CONTAINER_OBJECT_TYPE,
      objectId: container.id,
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

    const rootMetadata = await createContainerMetadataDocument(tx, {
      authorFingerprint: fingerprint,
      containerId: container.id,
      createdByFingerprint: fingerprint,
      initialMetadataUpdates: input.initialRootMetadataUpdates,
      ...(input.initialRootMetadataRecipientEnvelopes
        ? {
            initialMetadataRecipientEnvelopes:
              input.initialRootMetadataRecipientEnvelopes,
          }
        : {}),
    });

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

  await runtime.keyValueStore.set(fingerprint, bytesToBase64(signingKeyBytes));

  const challengeBytes = generateChallenge();
  const challengeHex = bytesToHex(challengeBytes);
  await runtime.keyValueStore.set(
    `challenge:${fingerprint}`,
    challengeHex,
    CHALLENGE_TTL_SECONDS,
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
