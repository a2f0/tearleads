import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { generateKemSeedAndKeyPair } from "./encapsulation/generateKeyPair";
import { toFingerprint } from "./fingerprint";
import {
  computePrincipalMembershipRoot,
  computePrincipalStateHash,
  serializeUnsignedPrincipalState,
  signPrincipalState,
  verifySignedPrincipalState,
} from "./principalState";
import { generateSigningSeedAndKeyPair } from "./signing/generateKeyPair";

test("signPrincipalState normalizes members and produces a verifiable state hash", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signedState = await signPrincipalState(
    {
      principalType: "group",
      principalId: crypto.randomUUID(),
      version: 2,
      prevStateHash: "prev-state-hash",
      keyEpoch: 3,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members: [
        {
          principalType: "group",
          principalId: "nested-group",
        },
        {
          principalType: "user",
          principalId: "alice",
        },
      ],
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      signerUserId: crypto.randomUUID(),
      signerUserKeyFingerprint: await toFingerprint(signingPublicKey),
    },
    signingPrivateKey,
  );

  const serializedState = await serializeUnsignedPrincipalState(signedState);
  expect(serializedState).toContain('"membershipMode":"projection_v1"');
  expect(serializedState).toContain('"memberCount":2');
  expect(await verifySignedPrincipalState(signedState, signingPublicKey)).toBe(
    true,
  );
  expect(await computePrincipalStateHash(signedState)).toHaveLength(64);
});

test("signPrincipalState computes membershipRoot and key fingerprint from normalized inputs", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const expectedMembershipRoot = await computePrincipalMembershipRoot([
    {
      principalType: "group",
      principalId: "nested-group",
    },
    {
      principalType: "user",
      principalId: "alice",
    },
  ]);
  const signedState = await signPrincipalState(
    {
      principalType: "organization",
      principalId: crypto.randomUUID(),
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
        {
          principalType: "group",
          principalId: "nested-group",
        },
      ],
      membershipRoot: expectedMembershipRoot,
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      signerUserId: crypto.randomUUID(),
      signerUserKeyFingerprint: await toFingerprint(signingPublicKey),
    },
    signingPrivateKey,
  );

  expect(signedState.membershipRoot).toBe(expectedMembershipRoot);
});

test("verifySignedPrincipalState rejects tampered membership roots", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signedState = await signPrincipalState(
    {
      principalType: "group",
      principalId: crypto.randomUUID(),
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
      signerUserId: crypto.randomUUID(),
      signerUserKeyFingerprint: await toFingerprint(signingPublicKey),
    },
    signingPrivateKey,
  );

  expect(
    await verifySignedPrincipalState(
      {
        ...signedState,
        membershipRoot: "tampered-root",
      },
      signingPublicKey,
    ),
  ).toBe(false);
});
