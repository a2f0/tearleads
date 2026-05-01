import {
  buildPrincipalStateSigningInput,
  normalizePrincipalProjectionMembers,
  type PrincipalProjectionMember,
  type PrincipalStateHeaderInput,
  type PrincipalStateMember,
  signPrincipalState,
} from "@tearleads/crypto";
import type { PrincipalStateBundleInput } from "../../src/access/write/principalStateStore";

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
