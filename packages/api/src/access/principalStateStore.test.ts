import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  getCurrentPrincipalEpochKey,
  getCurrentPrincipalState,
  storeVerifiedPrincipalState,
} from "./principalStateStore";

test("storeVerifiedPrincipalState persists the latest signed principal state and epoch key", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const principalId = crypto.randomUUID();
  const signedState = await signPrincipalState(
    {
      principalType: "group",
      principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members: [
        {
          principalType: "user",
          principalId: "bob",
        },
        {
          principalType: "group",
          principalId: "nested-group",
        },
      ],
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      signerKeyId: "policy-key-1",
    },
    signingPrivateKey,
  );

  const storedState = await storeVerifiedPrincipalState(
    signedState,
    signingPublicKey,
  );

  expect(storedState.stateHash).toBe(
    await computePrincipalStateHash(signedState),
  );
  expect(storedState.members).toEqual([
    {
      principalType: "group",
      principalId: "nested-group",
    },
    {
      principalType: "user",
      principalId: "bob",
    },
  ]);

  const currentState = await getCurrentPrincipalState("group", principalId);
  expect(currentState?.stateHash).toBe(storedState.stateHash);
  expect(currentState?.keyEpoch).toBe(1);

  const currentEpochKey = await getCurrentPrincipalEpochKey(
    "group",
    principalId,
  );
  expect(currentEpochKey?.epoch).toBe(1);
  expect(currentEpochKey?.introducedByStateHash).toBe(storedState.stateHash);
  expect(currentEpochKey?.keyFingerprint).toBe(await toFingerprint(publicKey));
});

test("storeVerifiedPrincipalState rejects invalid signatures", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey } = generateSigningSeedAndKeyPair();
  const { signingPublicKey: wrongSigningPublicKey } =
    generateSigningSeedAndKeyPair();
  const principalId = crypto.randomUUID();
  const signedState = await signPrincipalState(
    {
      principalType: "organization",
      principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members: [
        {
          principalType: "user",
          principalId: "alice",
        },
      ],
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      signerKeyId: "policy-key-2",
    },
    signingPrivateKey,
  );

  await expect(
    storeVerifiedPrincipalState(signedState, wrongSigningPublicKey),
  ).rejects.toThrow("Invalid principal state signature");
});
