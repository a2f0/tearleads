import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import {
  AES_GCM_TAG_BYTES,
  computeUserIdentityBundleFingerprint,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  ML_KEM1024_CIPHERTEXT_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { signPrincipalStateBundle } from "./principalState";

export const identityTrustDomain = "https://api.example.test/v1";

export async function createRegisteredPolicyIdentity() {
  const userId = crypto.randomUUID();
  const signing = generateSigningSeedAndKeyPair();
  const kem = generateKemSeedAndKeyPair();
  const identity = {
    userId,
    signingPublicKey: signing.signingPublicKey,
    encapsulationPublicKey: kem.publicKey,
    identityTrustDomain,
  };
  const identityBundleFingerprint =
    await computeUserIdentityBundleFingerprint(identity);
  const fingerprint = await toFingerprint(signing.signingPublicKey);
  const encapsulationKeyFingerprint = await toFingerprint(kem.publicKey);
  await db.insert(users).values({
    id: userId,
    fingerprint,
    encapsulationKeyFingerprint,
    signingPublicKey: bytesToBase64(signing.signingPublicKey),
    encapsulationPublicKey: bytesToBase64(kem.publicKey),
    defaultOrganizationId: crypto.randomUUID(),
  });
  return {
    ...identity,
    identityBundleFingerprint,
    fingerprint,
    encapsulationKeyFingerprint,
    signingPrivateKey: signing.signingPrivateKey,
  };
}

export async function createIdentityBoundPolicy(input?: {
  readonly memberIdentityBundleFingerprint?: (
    member: Awaited<ReturnType<typeof createRegisteredPolicyIdentity>>,
  ) => Promise<string>;
}) {
  const signer = await createRegisteredPolicyIdentity();
  const member = await createRegisteredPolicyIdentity();
  const kem = generateKemSeedAndKeyPair();
  const projection = [
    {
      userId: signer.userId,
      role: "admin" as const,
      identityBundleFingerprint: signer.identityBundleFingerprint,
    },
    {
      userId: member.userId,
      role: "member" as const,
      identityBundleFingerprint: input?.memberIdentityBundleFingerprint
        ? await input.memberIdentityBundleFingerprint(member)
        : member.identityBundleFingerprint,
    },
  ];
  const signingInput = {
    principalType: "group" as const,
    principalId: crypto.randomUUID(),
    version: 1,
    prevStateHash: null,
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(kem.publicKey),
    keyFingerprint: await toFingerprint(kem.publicKey),
    members: projection.map(({ userId }) => ({ userId })),
    projection,
    memberEnvelopes: [signer, member].map((identity) => ({
      userId: identity.userId,
      memberKeyFingerprint: identity.encapsulationKeyFingerprint,
      kemCipherText: bytesToBase64(new Uint8Array(ML_KEM1024_CIPHERTEXT_BYTES)),
      wrappedKey: bytesToBase64(
        new Uint8Array(ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES),
      ),
    })),
    payloadCiphertext: "ciphertext",
    signedAt: "2026-10-01T00:00:00.000Z",
    signerUserId: signer.userId,
    signerUserKeyFingerprint: signer.fingerprint,
    signingPrivateKey: signer.signingPrivateKey,
  };
  return {
    signer,
    member,
    signingInput,
    bundle: await signPrincipalStateBundle(signingInput),
  };
}
