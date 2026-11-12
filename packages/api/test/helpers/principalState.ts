import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import {
  buildPrincipalStateSigningInput,
  normalizePrincipalProjectionMembers,
  type PrincipalProjectionMember,
  type PrincipalStateExternalAuthority,
  type PrincipalStateHeaderInput,
  type PrincipalStateMember,
  signPrincipalState,
} from "@tearleads/crypto";
import {
  type PrincipalStateBundleInput,
  type StoreVerifiedPrincipalStateOptions,
  storeVerifiedPrincipalStateInTransaction,
} from "../../src/access/write/principalStateStore";
import { parseOrganizationAuthorityDescriptor } from "../../src/workflows/organizations/organizationAuthorityDescriptor";
import { storeVerifiedPrincipalDirectoryBindings } from "../../src/workflows/principals/storeVerifiedPrincipalDirectoryBindings";
import {
  type FixtureProjectionMember,
  registeredProjection,
} from "./policyProjection";

export function storePrincipalState(
  input: PrincipalStateBundleInput,
  database: ApiDatabase,
  options?: StoreVerifiedPrincipalStateOptions,
) {
  return database.transaction(async (tx) => {
    const { state } = await storeVerifiedPrincipalStateInTransaction(
      input,
      tx,
      options,
    );
    // Generic cryptographic fixtures may use an opaque organization payload.
    // Real signed directories seed the same lookup projection as production.
    if (
      state.principalType === "organization" &&
      parseOrganizationAuthorityDescriptor(input.encryptedPayload.ciphertext)
    )
      await storeVerifiedPrincipalDirectoryBindings({
        executor: tx,
        state,
        ciphertext: input.encryptedPayload.ciphertext,
      });
    return state;
  });
}

export async function createProjectionWithAdminSigner(
  signerUserId: string,
  members: ReadonlyArray<PrincipalStateMember>,
): Promise<PrincipalProjectionMember[]> {
  const projectionByMember = new Map<string, FixtureProjectionMember>();

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
    await registeredProjection(Array.from(projectionByMember.values())),
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
    "externalAuthority" | "grants" | "memberEnvelopes" | "projection"
  > & {
    projection: readonly FixtureProjectionMember[];
    externalAuthority?: PrincipalStateHeaderInput["externalAuthority"];
    grants?: PrincipalStateHeaderInput["grants"];
    memberEnvelopes?: PrincipalStateHeaderInput["memberEnvelopes"];
    signingPrivateKey: Uint8Array;
  },
): Promise<PrincipalStateBundleInput> {
  const projection = await registeredProjection(input.projection);
  const memberEnvelopes = input.memberEnvelopes ?? [];
  const grants = input.grants ?? [];
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      ...input,
      projection,
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
    projection: normalizePrincipalProjectionMembers(projection),
    grants,
    memberEnvelopes,
  };
}
