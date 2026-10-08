import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { PutPrincipalPolicyRequestSchema } from "@tearleads/validators/request";
import {
  CurrentPrincipalMemberEnvelopesResponseSchema,
  OrganizationGroupCurrentStateResponseSchema,
  PrincipalStateExternalAuthorityResponseSchema,
  PrincipalStateResponseSchema,
  ReferencedPrincipalStateResponseSchema,
} from "@tearleads/validators/response";
import { generateKemSeedAndKeyPair } from "./encapsulation/generateKeyPair";
import { toFingerprint } from "./fingerprint";
import { normalizeReferencedPrincipalHead } from "./keying/accessEvent";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  signPrincipalState,
} from "./principalState";
import { verifySignedPrincipalState } from "./principalStateVerification";
import { generateSigningSeedAndKeyPair } from "./signing/generateKeyPair";

async function fixture(principalType: "group" | "organization") {
  const kem = generateKemSeedAndKeyPair();
  const signing = generateSigningSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const projection = [{ userId: signerUserId, role: "admin" as const }];
  const state = await buildPrincipalStateSigningInput({
    principalType,
    principalId: crypto.randomUUID(),
    version: 1,
    prevStateHash: null,
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(kem.publicKey),
    keyFingerprint: await toFingerprint(kem.publicKey),
    members: [{ userId: signerUserId }],
    memberEnvelopes: [],
    projection,
    grants: [],
    payloadCiphertext: "epoch-boundary",
    externalAuthority: null,
    signedAt: "2026-10-04T12:00:00.000Z",
    signerUserId,
    signerUserKeyFingerprint: await toFingerprint(signing.signingPublicKey),
  });
  return {
    signing,
    request: {
      state: { ...state, signature: "" },
      encryptedPayload: {
        cipherSuite: "aes-256-gcm",
        ciphertext: "epoch-boundary",
        ciphertextHash: state.payloadCiphertextHash,
      },
      memberEnvelopes: [],
      projection,
      grants: [],
    },
  };
}

for (const principalType of ["group", "organization"] as const) {
  test(`${principalType} key epochs use exact integers across signing and wire contracts`, async () => {
    const { request, signing } = await fixture(principalType);
    for (const keyEpoch of [16_384, 16_385, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      const state = await signPrincipalState(
        { ...request.state, keyEpoch, prevStateHash: "predecessor" },
        signing.signingPrivateKey,
      );
      expect(
        PutPrincipalPolicyRequestSchema.safeParse({ ...request, state })
          .success,
      ).toBe(true);
      expect(
        await verifySignedPrincipalState(state, signing.signingPublicKey),
      ).toBe(true);
      expect(await computePrincipalStateHash(state)).toHaveLength(64);
    }
    for (const keyEpoch of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Infinity,
      NaN,
    ]) {
      const state = { ...request.state, keyEpoch };
      expect(
        PutPrincipalPolicyRequestSchema.safeParse({ ...request, state })
          .success,
      ).toBe(false);
      await expect(
        signPrincipalState(state, signing.signingPrivateKey),
      ).rejects.toThrow();
      await expect(computePrincipalStateHash(state)).rejects.toThrow();
    }
  });
}

test("principal authority and response references use the same exact epoch domain", async () => {
  const { request, signing } = await fixture("organization");
  for (const keyEpoch of [
    16_385,
    Number.MAX_SAFE_INTEGER,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const valid = Number.isSafeInteger(keyEpoch) && keyEpoch > 0;
    const externalAuthority = {
      principalType: "group" as const,
      principalId: crypto.randomUUID(),
      stateHash: "a".repeat(64),
      version: 3,
      keyEpoch,
      keyFingerprint: request.state.keyFingerprint,
    };
    expect(
      OrganizationGroupCurrentStateResponseSchema.safeParse({
        ...externalAuthority,
        memberCount: 1,
      }).success,
    ).toBe(valid);
    if (valid) {
      expect(normalizeReferencedPrincipalHead(externalAuthority).keyEpoch).toBe(
        keyEpoch,
      );
    } else {
      expect(() =>
        normalizeReferencedPrincipalHead(externalAuthority),
      ).toThrow();
    }
    expect(
      CurrentPrincipalMemberEnvelopesResponseSchema.safeParse({
        principalType: "group",
        principalId: externalAuthority.principalId,
        stateHash: externalAuthority.stateHash,
        epoch: keyEpoch,
        envelopes: [],
      }).success,
    ).toBe(valid);
    const state = { ...request.state, externalAuthority };
    expect(
      PutPrincipalPolicyRequestSchema.safeParse({ ...request, state }).success,
    ).toBe(valid);
    expect(
      PrincipalStateExternalAuthorityResponseSchema.safeParse(externalAuthority)
        .success,
    ).toBe(valid);
    expect(
      ReferencedPrincipalStateResponseSchema.safeParse(externalAuthority)
        .success,
    ).toBe(valid);
    expect(
      PrincipalStateResponseSchema.safeParse({
        ...request.state,
        keyEpoch,
        stateHash: "a".repeat(64),
        createdAt: request.state.signedAt,
      }).success,
    ).toBe(valid);
    if (valid) {
      const signed = await signPrincipalState(state, signing.signingPrivateKey);
      expect(
        await verifySignedPrincipalState(signed, signing.signingPublicKey),
      ).toBe(true);
    } else {
      await expect(
        signPrincipalState(state, signing.signingPrivateKey),
      ).rejects.toThrow();
    }
  }
});
