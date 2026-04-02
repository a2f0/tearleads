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
    const { signingPublicKey, encapsulationPublicKey, wrappedDekEnvelope } =
      c.req.valid("json");
    const signingKeyBytes = new Uint8Array(signingPublicKey);
    const encapsulationKeyBytes = new Uint8Array(encapsulationPublicKey);
    const fingerprint = await toFingerprint(signingKeyBytes);

    const result = await db.transaction(async (tx) => {
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
          defaultOrganizationId: org.id,
        })
        .onConflictDoNothing({ target: users.fingerprint })
        .returning({ id: users.id });

      if (!user) {
        return null;
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
        containerId: container.id,
      };
    });

    if (!result) {
      return c.json({ error: "Key already exists" }, 409);
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
      containerId: result.containerId,
      challenge: challengeHex,
    });
  },
);
