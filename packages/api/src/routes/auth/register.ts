import {
  bytesToHex,
  CHALLENGE_TTL_SECONDS,
  generateChallenge,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isPublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { computeAccessFingerprint } from "../../access/accessFingerprint";
import { db } from "../../adapters/postgres";
import { set } from "../../adapters/redis";
import { publish } from "../../adapters/redisPubSub";
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

const CONTAINER_OBJECT_TYPE = "container";
const DUPLICATE_FINGERPRINT_ERROR = "REGISTER_DUPLICATE_FINGERPRINT";
const ML_KEM1024_CIPHERTEXT_LENGTH = 1568;
const WRAPPED_DEK_LENGTH = 48;

export const registerRoute = new Hono();

registerRoute.post(
  "/auth/register",
  validator("json", (value, c) => {
    if (!isPublicKeyRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }
    return value;
  }),
  async (c) => {
    const {
      rootContainerId,
      signingPublicKey,
      encapsulationPublicKey,
      initialRootMetadataRecipientEnvelopes,
      initialRootMetadataUpdates,
      wrappedDekEnvelope,
    } = c.req.valid("json");
    const signingKeyBytes = new Uint8Array(signingPublicKey);
    const encapsulationKeyBytes = new Uint8Array(encapsulationPublicKey);
    const fingerprint = await toFingerprint(signingKeyBytes);
    const encapsulationFingerprint = await toFingerprint(encapsulationKeyBytes);

    if (wrappedDekEnvelope.keyFingerprint !== encapsulationFingerprint) {
      return c.json(
        {
          error:
            "wrappedDekEnvelope.keyFingerprint does not match encapsulationPublicKey",
        },
        400,
      );
    }

    if (
      wrappedDekEnvelope.kemCipherText.length !== ML_KEM1024_CIPHERTEXT_LENGTH
    ) {
      return c.json(
        { error: "Invalid wrappedDekEnvelope.kemCipherText length" },
        400,
      );
    }

    if (wrappedDekEnvelope.wrappedKey.length !== WRAPPED_DEK_LENGTH) {
      return c.json(
        { error: "Invalid wrappedDekEnvelope.wrappedKey length" },
        400,
      );
    }

    let result: {
      userId: string;
      organizationId: string;
      rootContainerId: string;
      rootMetadataAccessEpoch: number;
      rootMetadataDocumentId: string;
      rootMetadataRecipientEncapsulationPublicKeys: string[];
    };
    try {
      result = await db.transaction(async (tx) => {
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
            id: rootContainerId,
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
              {
                userId: user.id,
                accessLevel: "admin",
                keyFingerprint: wrappedDekEnvelope.keyFingerprint,
              },
            ],
          }),
          updatedAt: new Date(),
        });

        await tx.insert(objectRecipientEnvelopes).values({
          objectType: CONTAINER_OBJECT_TYPE,
          objectId: container.id,
          epoch: 1,
          recipientUserId: user.id,
          recipientKeyFingerprint: wrappedDekEnvelope.keyFingerprint,
          kemCipherText: bytesToBase64(
            new Uint8Array(wrappedDekEnvelope.kemCipherText),
          ),
          wrappedKey: bytesToBase64(
            new Uint8Array(wrappedDekEnvelope.wrappedKey),
          ),
        });

        const rootMetadata = await createContainerMetadataDocument(
          tx,
          initialRootMetadataRecipientEnvelopes
            ? {
                authorFingerprint: fingerprint,
                containerId: container.id,
                createdByFingerprint: fingerprint,
                initialMetadataRecipientEnvelopes:
                  initialRootMetadataRecipientEnvelopes,
                initialMetadataUpdates: initialRootMetadataUpdates,
              }
            : {
                authorFingerprint: fingerprint,
                containerId: container.id,
                createdByFingerprint: fingerprint,
                initialMetadataUpdates: initialRootMetadataUpdates,
              },
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
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === DUPLICATE_FINGERPRINT_ERROR
      ) {
        return c.json({ error: "Key already exists" }, 409);
      }

      if (error instanceof ContainerMetadataError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }

    await set(fingerprint, bytesToBase64(signingKeyBytes));

    const challengeBytes = generateChallenge();
    const challengeHex = bytesToHex(challengeBytes);
    await set(`challenge:${fingerprint}`, challengeHex, CHALLENGE_TTL_SECONDS);

    await publish({
      type: "user_registered",
      userId: result.userId,
      fingerprint,
    });

    return c.json<PublicKeyResponse>({
      message: "ok",
      userId: result.userId,
      organizationId: result.organizationId,
      rootContainerId: result.rootContainerId,
      rootMetadataDocumentId: result.rootMetadataDocumentId,
      rootMetadataAccessEpoch: result.rootMetadataAccessEpoch,
      rootMetadataRecipientEncapsulationPublicKeys:
        result.rootMetadataRecipientEncapsulationPublicKeys,
      challenge: challengeHex,
    });
  },
);
