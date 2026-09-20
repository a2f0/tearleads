import { expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { wrapDekForRecipients } from "../encapsulation/wrapDek";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { computeAccessManifestHash } from "./accessEvent";
import {
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
} from "./containerAccess";
import {
  deriveContainerKekWrappingPublicKey,
  normalizeContainerKekWrappingPublicKey,
  unwrapContainerKekParentWrap,
} from "./containerKekWrapping";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
} from "./testFixtures";

const parent = {
  containerId: "parent",
  keyMaterial: new Uint8Array(32).fill(1),
};

test("public parent wrapping is deterministic and separated by container and key", async () => {
  const publicKey = await deriveContainerKekWrappingPublicKey(parent);
  expect(await deriveContainerKekWrappingPublicKey(parent)).toBe(publicKey);
  expect(
    await deriveContainerKekWrappingPublicKey({
      ...parent,
      containerId: "other",
    }),
  ).not.toBe(publicKey);
  expect(
    await deriveContainerKekWrappingPublicKey({
      ...parent,
      keyMaterial: new Uint8Array(32).fill(2),
    }),
  ).not.toBe(publicKey);
  expect(normalizeContainerKekWrappingPublicKey(publicKey)).toBe(publicKey);
});

test("a public-only writer can wrap a child, but only the right parent can open it", async () => {
  const publicKey = await deriveContainerKekWrappingPublicKey(parent);
  const child = crypto.getRandomValues(new Uint8Array(32));
  const [wrapped] = await wrapDekForRecipients(child, [
    base64ToBytes(publicKey),
  ]);
  if (!wrapped) throw new Error("Expected parent wrap");
  const envelope = {
    kemCipherText: bytesToBase64(wrapped.kemCipherText),
    wrappedKey: bytesToBase64(wrapped.wrappedKey),
  };
  const input = {
    ...envelope,
    parentContainerId: parent.containerId,
    parentKeyMaterial: parent.keyMaterial,
  };
  expect(await unwrapContainerKekParentWrap(input)).toEqual(child);
  await expect(
    unwrapContainerKekParentWrap({ ...input, parentContainerId: "other" }),
  ).rejects.toThrow();
  await expect(
    unwrapContainerKekParentWrap({
      ...input,
      parentKeyMaterial: new Uint8Array(32).fill(2),
    }),
  ).rejects.toThrow();
  await expect(
    unwrapContainerKekParentWrap({
      ...input,
      kemCipherText: bytesToBase64(new Uint8Array(12)),
    }),
  ).rejects.toThrow("ciphertext has invalid length");
  const altered = wrapped.wrappedKey.slice();
  altered[0] = (altered[0] ?? 0) ^ 1;
  await expect(
    unwrapContainerKekParentWrap({
      ...input,
      wrappedKey: bytesToBase64(altered),
    }),
  ).rejects.toThrow();
});

test("signed public keys require canonical encodings and FIPS 203 modulus checks", async () => {
  const publicKey = await deriveContainerKekWrappingPublicKey(parent);
  const bytes = base64ToBytes(publicKey);
  // First coefficient q=3329 encoded in the low twelve bits.
  bytes[0] = 1;
  bytes[1] = ((bytes[1] ?? 0) & 240) | 13;
  for (const invalid of [
    undefined,
    "",
    "AAAA",
    `${publicKey}\n`,
    bytesToBase64(bytes),
  ]) {
    expect(() => normalizeContainerKekWrappingPublicKey(invalid)).toThrow();
  }
  expect(normalizeContainerKekWrappingPublicKey(null)).toBeNull();
});

test("the signed state requires a public key exactly when it names a KEK", async () => {
  const fixture = await createContainerManifestFixture({
    containerId: "fixture",
    directGrants: [],
  });
  const missing = { ...fixture.state };
  Reflect.deleteProperty(missing, "containerKeyPublicKey");
  await expect(deriveContainerAccessManifest(missing)).rejects.toThrow();
  await expect(
    deriveContainerAccessManifest({
      ...fixture.state,
      containerKeyEpochId: "key",
    }),
  ).rejects.toThrow();
  await expect(
    deriveContainerAccessManifest({
      ...fixture.state,
      containerKeyPublicKey: "AAAA",
    }),
  ).rejects.toThrow();
});

test("a substituted public key cannot satisfy the original signed manifest", async () => {
  const fixture = await createContainerManifestFixture({
    containerId: "fixture",
    containerKeyEpochId: "key-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: "fixture-signer",
        accessLevel: "admin",
      },
    ],
  });
  const publicKey = await deriveContainerKekWrappingPublicKey(parent);
  const manifest = await deriveContainerAccessManifest({
    ...fixture.state,
    containerKeyPublicKey: publicKey,
  });
  const verified = await verifyContainerAccessManifest({
    event: fixture.event,
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    parentContainerPath: [],
    previousManifest: null,
    principalPolicies: [],
  });
  expect(verified.ok).toBe(false);
});

test("even an authorized same-epoch grant cannot replace the wrapping public key", async () => {
  const signer = generateSigningSeedAndKeyPair();
  const fixture = await createContainerManifestFixture({
    containerId: "fixture",
    containerKeyEpochId: "key-1",
    signer,
    directGrants: [
      {
        subjectType: "user",
        subjectId: "fixture-signer",
        accessLevel: "admin",
      },
    ],
  });
  const body = {
    eventType: "container.grant" as const,
    containerKeyEpochId: "key-1",
    containerKeyPublicKey: await deriveContainerKekWrappingPublicKey(parent),
    grant: {
      subjectType: "user" as const,
      subjectId: "reader",
      accessLevel: "read" as const,
    },
    referencedPrincipalHead: null,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: "fixture",
    organizationId: fixture.state.organizationId,
    signer,
    signerUserId: "fixture-signer",
    previousManifestHash: fixture.manifestHash,
    dependencyManifestHashes: [fixture.manifestHash],
  });
  const manifest = await deriveContainerAccessManifest({
    ...fixture.state,
    epoch: 2,
    eventHash: event.eventHash,
    previousManifestHash: fixture.manifestHash,
    containerKeyPublicKey: body.containerKeyPublicKey,
    directGrants: [...fixture.state.directGrants, body.grant],
  });
  const verified = await verifyContainerAccessManifest({
    event,
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    previousManifest: fixture,
    previousContainerPath: [fixture],
    principalPolicies: [],
  });
  expect(verified.ok).toBe(false);
  if (!verified.ok) expect(verified.error.code).toBe("key_epoch_reuse");
});
