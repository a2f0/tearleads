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

const CONTAINER_OBJECT_TYPE = "container";
const DUPLICATE_FINGERPRINT_ERROR = "REGISTER_DUPLICATE_FINGERPRINT";
const ML_KEM1024_CIPHERTEXT_LENGTH = 1568;
const WRAPPED_DEK_LENGTH = 48;
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      wrappedDekEnvelope,
    } = c.req.valid("json");
    const signingKeyBytes = new Uint8Array(signingPublicKey);
    const encapsulationKeyBytes = new Uint8Array(encapsulationPublicKey);
    const fingerprint = await toFingerprint(signingKeyBytes);
    const encapsulationFingerprint = await toFingerprint(encapsulationKeyBytes);

    if (!UUID_V4_REGEX.test(rootContainerId)) {
      return c.json(
        { error: "Invalid rootContainerId: must be a valid UUIDv4" },
        400,
      );
    }

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
            name: "/",
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

        return {
          userId: user.id,
          organizationId: org.id,
          rootContainerId: container.id,
        };
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === DUPLICATE_FINGERPRINT_ERROR
      ) {
        return c.json({ error: "Key already exists" }, 409);
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
      challenge: challengeHex,
    });
  },
);
