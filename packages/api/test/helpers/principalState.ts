import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import {
  buildPrincipalStateSigningInput,
  normalizePrincipalProjectionMembers,
  type PrincipalProjectionMember,
  type PrincipalStateHeaderInput,
  type PrincipalStateMember,
  signPrincipalState,
} from "@tearleads/crypto";
import {
  type PrincipalStateBundleInput,
  type StoreVerifiedPrincipalStateOptions,
  storeVerifiedPrincipalStateInTransaction,
} from "../../src/access/write/principalStateStore";

export function storePrincipalState(
  input: PrincipalStateBundleInput,
  database: ApiDatabase,
  options?: StoreVerifiedPrincipalStateOptions,
) {
  return database.transaction((tx) =>
    storeVerifiedPrincipalStateInTransaction(input, tx, options),
  );
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
  input: Omit<PrincipalStateHeaderInput, "memberEnvelopes"> & {
    memberEnvelopes?: PrincipalStateHeaderInput["memberEnvelopes"];
    signingPrivateKey: Uint8Array;
  },
): Promise<PrincipalStateBundleInput> {
  const memberEnvelopes = input.memberEnvelopes ?? [];
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({ ...input, memberEnvelopes }),
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
    memberEnvelopes,
  };
}
