import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import {
  buildPrincipalStateSigningInput,
  normalizePrincipalProjectionMembers,
  type PrincipalProjectionMember,
  type PrincipalStateExternalAuthority,
  type PrincipalStateHeaderInput,
  type PrincipalStateMember,
  signPrincipalState,
} from "@symcrypt/crypto";
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

  projectionByMember.set(signerUserId, {
    userId: signerUserId,
    role: "admin",
  });

  for (const member of members) {
    const key = member.userId;
    if (key === signerUserId) {
      continue;
    }
    projectionByMember.set(key, {
      userId: member.userId,
      role: "member",
    });
  }

  return normalizePrincipalProjectionMembers(
    Array.from(projectionByMember.values()),
  );
}

export function toPrincipalStateExternalAuthority(
  state: Omit<PrincipalStateExternalAuthority, "principalType">,
): PrincipalStateExternalAuthority {
  return {
    principalType: "group",
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  };
}

export async function signPrincipalStateBundle(
  input: Omit<
    PrincipalStateHeaderInput,
    "externalAuthority" | "grants" | "memberEnvelopes"
  > & {
    externalAuthority?: PrincipalStateHeaderInput["externalAuthority"];
    grants?: PrincipalStateHeaderInput["grants"];
    memberEnvelopes?: PrincipalStateHeaderInput["memberEnvelopes"];
    signingPrivateKey: Uint8Array;
  },
): Promise<PrincipalStateBundleInput> {
  const memberEnvelopes = input.memberEnvelopes ?? [];
  const grants = input.grants ?? [];
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      ...input,
      externalAuthority: input.externalAuthority ?? null,
      grants,
      memberEnvelopes,
    }),
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
    grants,
    memberEnvelopes,
  };
}
