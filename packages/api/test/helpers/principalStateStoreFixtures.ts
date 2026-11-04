import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { signPrincipalStateBundle } from "./principalState";

export async function createPrincipalStateSigner(
  signingPublicKey: Uint8Array,
): Promise<{ signerUserId: string; signerUserKeyFingerprint: string }> {
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const signerUserKeyFingerprint = await toFingerprint(signingPublicKey);

  await db.insert(users).values({
    id: signerUserId,
    fingerprint: signerUserKeyFingerprint,
    signingPublicKey: bytesToBase64(signingPublicKey),
    encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    encapsulationKeyFingerprint: await toFingerprint(
      encapsulationKeyPair.publicKey,
    ),
    defaultOrganizationId: crypto.randomUUID(),
  });

  return { signerUserId, signerUserKeyFingerprint };
}

export async function signPrincipalState(
  input: Omit<
    Parameters<typeof signPrincipalStateBundle>[0],
    "payloadCiphertext" | "signingPrivateKey"
  >,
  signingPrivateKey: Uint8Array,
): ReturnType<typeof signPrincipalStateBundle> {
  return signPrincipalStateBundle({
    ...input,
    payloadCiphertext: JSON.stringify({ members: input.projection }),
    signingPrivateKey,
  });
}
