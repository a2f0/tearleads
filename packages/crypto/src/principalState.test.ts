import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { generateKemSeedAndKeyPair } from "./encapsulation/generateKeyPair";
import { toFingerprint } from "./fingerprint";
import {
  buildPrincipalStateSigningInput,
  computePrincipalMembershipRoot,
  computePrincipalProjectionRoot,
  computePrincipalStateHash,
  derivePrincipalProjectionMembers,
  type SignedPrincipalState,
  serializeUnsignedPrincipalState,
  signPrincipalState,
  verifySignedPrincipalState,
} from "./principalState";
import { generateSigningSeedAndKeyPair } from "./signing/generateKeyPair";

test("signPrincipalState normalizes members and produces a verifiable state hash", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const members = [
    {
      userId: "bob",
    },
    {
      userId: "alice",
    },
  ];
  const signedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: crypto.randomUUID(),
      version: 2,
      prevStateHash: "prev-state-hash",
      keyEpoch: 3,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members,
      memberEnvelopes: [],
      projection: derivePrincipalProjectionMembers(members),
      grants: [],
      payloadCiphertext: "ciphertext-1",
      externalAuthority: null,
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      signerUserId: crypto.randomUUID(),
      signerUserKeyFingerprint: await toFingerprint(signingPublicKey),
    }),
    signingPrivateKey,
  );

  const serializedState = await serializeUnsignedPrincipalState(signedState);
  expect(serializedState).toContain('"membershipMode":"projection"');
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
      userId: "bob",
    },
    {
      userId: "alice",
    },
  ]);
  const members = [
    {
      userId: "alice",
    },
    {
      userId: "bob",
    },
  ];
  const signedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "organization",
      principalId: crypto.randomUUID(),
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members,
      memberEnvelopes: [],
      projection: derivePrincipalProjectionMembers(members),
      grants: [],
      payloadCiphertext: "ciphertext-2",
      externalAuthority: null,
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      signerUserId: crypto.randomUUID(),
      signerUserKeyFingerprint: await toFingerprint(signingPublicKey),
    }),
    signingPrivateKey,
  );

  expect(signedState.membershipRoot).toBe(expectedMembershipRoot);
});

test("principal states require canonical, exact-length ML-KEM-1024 public keys", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signingInput = await buildPrincipalStateSigningInput({
    principalType: "group",
    principalId: crypto.randomUUID(),
    version: 1,
    prevStateHash: null,
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(publicKey),
    keyFingerprint: await toFingerprint(publicKey),
    members: [],
    memberEnvelopes: [],
    projection: [],
    grants: [],
    payloadCiphertext: "ciphertext",
    externalAuthority: null,
    signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
    signerUserId: crypto.randomUUID(),
    signerUserKeyFingerprint: await toFingerprint(signingPublicKey),
  });

  await expect(
    signPrincipalState(
      {
        ...signingInput,
        encapsulationPublicKey: `${signingInput.encapsulationPublicKey}\n`,
      },
      signingPrivateKey,
    ),
  ).rejects.toThrow("must use canonical base64 encoding");

  const truncatedPublicKey = publicKey.slice(0, -1);
  await expect(
    signPrincipalState(
      {
        ...signingInput,
        encapsulationPublicKey: bytesToBase64(truncatedPublicKey),
        keyFingerprint: await toFingerprint(truncatedPublicKey),
      },
      signingPrivateKey,
    ),
  ).rejects.toThrow("must contain exactly 1568 bytes");
});

test("principal roots reject duplicate members after normalization", async () => {
  await expect(
    computePrincipalMembershipRoot([
      {
        userId: "alice",
      },
      {
        userId: "user-team",
      },
      {
        userId: "alice",
      },
    ]),
  ).rejects.toThrow("Principal state cannot contain duplicate members");

  await expect(
    computePrincipalProjectionRoot([
      {
        userId: "team",
        role: "member",
      },
      {
        userId: "alice",
        role: "member",
      },
      {
        userId: "team",
        role: "admin",
      },
    ]),
  ).rejects.toThrow(
    "Principal state projection cannot contain duplicate members",
  );
});

test("verifySignedPrincipalState rejects tampered membership roots", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const members = [
    {
      userId: "alice",
    },
  ];
  const signedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: crypto.randomUUID(),
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members,
      memberEnvelopes: [],
      projection: derivePrincipalProjectionMembers(members),
      grants: [],
      payloadCiphertext: "ciphertext-3",
      externalAuthority: null,
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      signerUserId: crypto.randomUUID(),
      signerUserKeyFingerprint: await toFingerprint(signingPublicKey),
    }),
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

test("principal states reject missing current commitment fields at runtime", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: crypto.randomUUID(),
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members: [],
      memberEnvelopes: [],
      projection: [],
      grants: [],
      payloadCiphertext: "ciphertext-4",
      externalAuthority: null,
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      signerUserId: crypto.randomUUID(),
      signerUserKeyFingerprint: await toFingerprint(signingPublicKey),
    }),
    signingPrivateKey,
  );
  const missingCommitment: Partial<SignedPrincipalState> = {
    ...signedState,
  };
  delete missingCommitment.memberEnvelopesRoot;

  expect(
    await verifySignedPrincipalState(
      missingCommitment as SignedPrincipalState,
      signingPublicKey,
    ),
  ).toBe(false);
  await expect(
    serializeUnsignedPrincipalState(missingCommitment as SignedPrincipalState),
  ).rejects.toThrow("Principal state memberEnvelopesRoot is required");
});
