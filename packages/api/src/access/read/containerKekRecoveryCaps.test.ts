import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerKeyEpochs,
  containerKeyWraps,
} from "@tearleads/api-shared/schema";
import { recoverKeyringEntryFromWraps } from "@tearleads/client-sdk";
import {
  computeContainerKekMaterialId,
  generateKemSeedAndKeyPair,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  CONTAINER_KEK_LOG_PRINCIPAL_SCOPE_LIMIT,
  CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT,
} from "@tearleads/validators/util";
import {
  listContainerKeyWrapsByEpochId,
  toContainerKeyWrap,
} from "./containerKekStore";

function principalId(index: number): string {
  return `10000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

test("direct recovery survives principal and envelope caps", async () => {
  const containerId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const userKeys = generateKemSeedAndKeyPair();
  const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId,
    keyEpoch: 1,
    keyMaterial,
  });
  const manifestHash = `manifest:${crypto.randomUUID()}`;

  await db.insert(containerKeyEpochs).values({
    id: containerKeyEpochId,
    containerId,
    keyEpoch: 1,
    accessManifestHash: manifestHash,
    createdByEventHash: `event:${crypto.randomUUID()}`,
    createdByManifestHash: manifestHash,
  });

  const authorizedPrincipals = Array.from(
    { length: CONTAINER_KEK_LOG_PRINCIPAL_SCOPE_LIMIT },
    (_, index) => ({
      principalId: principalId(index),
      principalType: "group" as const,
    }),
  );
  // This last principal sorts before every in-scope id. If it entered the SQL
  // predicate, it would consume one of the bounded response's group slots.
  const beyondPrincipalId = "00000000-0000-4000-8000-000000000000";
  authorizedPrincipals.push({
    principalId: beyondPrincipalId,
    principalType: "group",
  });

  const [recipient] = await wrapDekForRecipients(keyMaterial, [
    userKeys.publicKey,
  ]);
  if (!recipient) throw new Error("expected a wrapped direct recipient key");
  await db.insert(containerKeyWraps).values([
    ...authorizedPrincipals.map(({ principalId: recipientId }) => ({
      containerKeyEpochId,
      recipientKind: "group" as const,
      recipientId,
      recipientKeyEpochId: `group:${recipientId}:epoch:1`,
      recipientKeyFingerprint: "0".repeat(64),
      kemCipherText: "AAAA",
      wrappedKey: "AAAA",
      wrapManifestHash: manifestHash,
    })),
    {
      containerKeyEpochId,
      recipientKind: "user",
      recipientId: userId,
      recipientKeyEpochId: `user:${userId}:encapsulation:${recipient.keyFingerprint}`,
      recipientKeyFingerprint: recipient.keyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
      wrapManifestHash: manifestHash,
    },
  ]);

  const served =
    (
      await listContainerKeyWrapsByEpochId([containerKeyEpochId], db, {
        authorizedPrincipals,
        parentContainerIds: [],
        userId,
      })
    ).get(containerKeyEpochId) ?? [];

  expect(served).toHaveLength(CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT);
  // The principal-scope cut is real, while the direct-user clause remains
  // independent of it and ranks first under the per-epoch envelope quota.
  expect(
    served.some(
      (wrap) =>
        wrap.recipientKind === "group" &&
        wrap.recipientId === beyondPrincipalId,
    ),
  ).toBe(false);
  expect(
    served.filter(
      (wrap) => wrap.recipientKind === "user" && wrap.recipientId === userId,
    ),
  ).toHaveLength(1);

  await expect(
    recoverKeyringEntryFromWraps({
      containerId,
      epoch: {
        containerKeyEpoch: 1,
        containerKeyEpochId,
        wraps: served.map(toContainerKeyWrap),
      },
      secretKey: userKeys.secretKey,
      userId,
    }),
  ).resolves.toEqual({ containerKeyEpochId, keyMaterial });
});
