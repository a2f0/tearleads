import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { generateKemSeedAndKeyPair } from "./encapsulation/generateKeyPair";
import { toFingerprint } from "./fingerprint";
import { readSignedAt } from "./keying/shared";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  serializeUnsignedPrincipalState,
  signPrincipalState,
  verifySignedPrincipalState,
} from "./principalState";
import { generateSigningSeedAndKeyPair } from "./signing/generateKeyPair";
import { sign } from "./signing/sign";
import { verify } from "./signing/verify";

const nonCanonicalTimestamps = [
  "2026-09-12T00:00:00Z",
  "2026-09-12T00:00:00.0000Z",
  "2026-09-12T01:00:00.000+01:00",
  "2026-09-12",
  "2026-02-30T00:00:00.000Z",
  "invalid",
];

async function createPrincipalInput() {
  const { publicKey } = generateKemSeedAndKeyPair();
  const signing = generateSigningSeedAndKeyPair();
  const input = await buildPrincipalStateSigningInput({
    principalType: "group",
    principalId: "group-1",
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
    signedAt: "2026-09-12T00:00:00.000Z",
    signerUserId: "alice",
    signerUserKeyFingerprint: await toFingerprint(signing.signingPublicKey),
  });
  return { input, ...signing };
}

test("signed timestamps must survive database ISO serialization unchanged", () => {
  for (const signedAt of nonCanonicalTimestamps) {
    expect(() => readSignedAt({ signedAt }, "signedAt", "event")).toThrow();
  }
  const signedAt = "2026-09-12T00:00:00.123Z";
  expect(readSignedAt({ signedAt }, "signedAt", "event")).toBe(signedAt);
});

test("principal signing, hashing and verification reject noncanonical timestamps", async () => {
  const { input, signingPrivateKey, signingPublicKey } =
    await createPrincipalInput();
  const signed = await signPrincipalState(input, signingPrivateKey);
  expect(await verifySignedPrincipalState(signed, signingPublicKey)).toBe(true);
  for (const signedAt of nonCanonicalTimestamps) {
    const malformed = { ...input, signedAt };
    await expect(
      signPrincipalState(malformed, signingPrivateKey),
    ).rejects.toThrow();
    await expect(computePrincipalStateHash(malformed)).rejects.toThrow();
    expect(
      await verifySignedPrincipalState(
        { ...signed, signedAt },
        signingPublicKey,
      ),
    ).toBe(false);
  }
});

test("principal state signatures and hashes bind their signing domain", async () => {
  const { input, signingPrivateKey, signingPublicKey } =
    await createPrincipalInput();
  const serialized = await serializeUnsignedPrincipalState(input);
  expect(serialized).toStartWith('{"domain":"tearleads.principal-state",');
  const bytes = new TextEncoder().encode(serialized);
  const signature = sign(bytes, signingPrivateKey);
  expect(
    await verifySignedPrincipalState(
      { ...input, signature: bytesToBase64(signature) },
      signingPublicKey,
    ),
  ).toBe(true);
  expect(await computePrincipalStateHash(input)).toBe(
    await toFingerprint(bytes),
  );

  for (const unbound of [
    serialized.replace('"domain":"tearleads.principal-state",', ""),
    serialized.replace("tearleads.principal-state", "tearleads.other-state"),
  ]) {
    const otherBytes = new TextEncoder().encode(unbound);
    expect(verify(signature, otherBytes, signingPublicKey)).toBe(false);
    expect(await toFingerprint(otherBytes)).not.toBe(
      await computePrincipalStateHash(input),
    );
    expect(
      await verifySignedPrincipalState(
        {
          ...input,
          signature: bytesToBase64(sign(otherBytes, signingPrivateKey)),
        },
        signingPublicKey,
      ),
    ).toBe(false);
  }
});
