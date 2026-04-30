import {
  buildPrincipalStateSigningInput,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  type PrincipalProjectionMember,
  type PrincipalStateHeaderInput,
  type PrincipalStateMember,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalStateBundleInput } from "../../src/access/principalStateStore";
import { db } from "../../src/adapters/postgres";
import { users } from "../../src/schema";

export async function createPrincipalStateSigner(
  signingKeys: ReturnType<
    typeof generateSigningSeedAndKeyPair
  > = generateSigningSeedAndKeyPair(),
): Promise<
  ReturnType<typeof generateSigningSeedAndKeyPair> & {
    signerUserId: string;
    signerUserKeyFingerprint: string;
  }
> {
  const encapsulationKeys = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const signerUserKeyFingerprint = await toFingerprint(
    signingKeys.signingPublicKey,
  );

  await db.insert(users).values({
    id: signerUserId,
    fingerprint: signerUserKeyFingerprint,
    signingPublicKey: bytesToBase64(signingKeys.signingPublicKey),
    encapsulationPublicKey: bytesToBase64(encapsulationKeys.publicKey),
    encapsulationKeyFingerprint: await toFingerprint(
      encapsulationKeys.publicKey,
    ),
    defaultOrganizationId: crypto.randomUUID(),
  });

  return {
    ...signingKeys,
    signerUserId,
    signerUserKeyFingerprint,
  };
}

export function createProjectionWithAdminSigner(
  signerUserId: string,
  members: ReadonlyArray<PrincipalStateMember>,
): PrincipalProjectionMember[] {
  const projectionByMember = new Map<string, PrincipalProjectionMember>();

  projectionByMember.set(`user:${signerUserId}`, {
    memberPrincipalType: "user",
    memberPrincipalId: signerUserId,
    role: "admin",
  });

  for (const member of members) {
    const key = `${member.principalType}:${member.principalId}`;
    if (key === `user:${signerUserId}`) {
      continue;
    }
    projectionByMember.set(key, {
      memberPrincipalType: member.principalType,
      memberPrincipalId: member.principalId,
      role: "member",
    });
  }

  return normalizePrincipalProjectionMembers(
    Array.from(projectionByMember.values()),
  );
}

export async function signPrincipalStateBundle(
  input: PrincipalStateHeaderInput & {
    signingPrivateKey: Uint8Array;
  },
): Promise<PrincipalStateBundleInput> {
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput(input),
    input.signingPrivateKey,
  );

  return {
    state,
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: input.payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
    },
    projection: normalizePrincipalProjectionMembers(input.projection),
  };
}
