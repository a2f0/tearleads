import type { ReferencedPrincipalHead } from "@symcrypt/crypto";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  signPrincipalState,
} from "@symcrypt/crypto";
import type { PutPrincipalPolicyRequest } from "@symcrypt/validators/request";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicyMutationResponse,
} from "@symcrypt/validators/response";
import type { buildInitialGroupPolicyRequest } from "../../src/workflows/organizations/principalPolicy";
import type { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";

type BundleState = Omit<
  PrincipalPolicyBundleResponse["currentState"],
  "createdAt" | "stateHash"
>;

export function principalPolicyHead(
  bundle: PrincipalPolicyBundleResponse,
  principalId = bundle.currentState.principalId,
): ReferencedPrincipalHead {
  return {
    principalType: bundle.currentState.principalType,
    principalId,
    version: bundle.currentState.version,
    keyEpoch: bundle.currentState.keyEpoch,
    stateHash: bundle.currentState.stateHash,
    keyFingerprint: bundle.currentState.keyFingerprint,
  };
}

/**
 * The one bundle-assembly core: hashes the signed state and expands it into
 * the server's policy bundle response shape.
 */
export async function principalPolicyBundleFromState(input: {
  readonly createdAt: string;
  readonly encryptedPayload: {
    readonly cipherSuite: PrincipalPolicyBundleResponse["currentPayload"]["cipherSuite"];
    readonly ciphertext: string;
    readonly ciphertextHash: string;
  };
  readonly memberEnvelopes: PrincipalPolicyBundleResponse["currentMemberEnvelopes"]["envelopes"];
  readonly grants?: PrincipalPolicyBundleResponse["currentGrants"];
  readonly previousStates?: PrincipalPolicyBundleResponse["previousStates"];
  readonly principalId?: string;
  readonly projection: PrincipalPolicyBundleResponse["currentProjection"];
  readonly state: BundleState;
}): Promise<PrincipalPolicyBundleResponse> {
  const stateHash = await computePrincipalStateHash(input.state);
  const principalType = input.state.principalType;
  const principalId = input.principalId ?? input.state.principalId;

  return {
    currentState: {
      ...input.state,
      createdAt: input.createdAt,
      stateHash,
    },
    currentPayload: {
      principalType,
      principalId,
      stateHash,
      cipherSuite: input.encryptedPayload.cipherSuite,
      ciphertext: input.encryptedPayload.ciphertext,
      ciphertextHash: input.encryptedPayload.ciphertextHash,
      createdAt: input.createdAt,
    },
    currentProjection: [...input.projection],
    currentGrants: [...(input.grants ?? [])],
    currentMemberEnvelopes: {
      principalType,
      principalId,
      stateHash,
      epoch: input.state.keyEpoch,
      envelopes: [...input.memberEnvelopes],
    },
    previousStates: input.previousStates ?? [],
  };
}

/**
 * Signs a principal state (members derived from the projection) and assembles
 * the resulting bundle — the sign-state → hash → bundle sequence the policy
 * fixture builders repeat.
 */
export async function signedPrincipalPolicyBundle(input: {
  readonly memberEnvelopes: PrincipalPolicyBundleResponse["currentMemberEnvelopes"]["envelopes"];
  readonly payloadCiphertext: string;
  readonly previousStates?: PrincipalPolicyBundleResponse["previousStates"];
  readonly projection: PrincipalPolicyBundleResponse["currentProjection"];
  readonly signing: Omit<
    Parameters<typeof buildPrincipalStateSigningInput>[0],
    | "grants"
    | "memberEnvelopes"
    | "members"
    | "payloadCiphertext"
    | "projection"
  > & {
    readonly grants?: Parameters<
      typeof buildPrincipalStateSigningInput
    >[0]["grants"];
  };
  readonly signingPrivateKey: Uint8Array;
}): Promise<PrincipalPolicyBundleResponse> {
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      ...input.signing,
      grants: input.signing.grants ?? [],
      members: input.projection.map((member) => ({ userId: member.userId })),
      memberEnvelopes: input.memberEnvelopes,
      payloadCiphertext: input.payloadCiphertext,
      projection: input.projection,
    }),
    input.signingPrivateKey,
  );

  return principalPolicyBundleFromState({
    createdAt: input.signing.signedAt,
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: input.payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
    },
    memberEnvelopes: input.memberEnvelopes,
    grants: input.signing.grants ?? [],
    ...(input.previousStates === undefined
      ? {}
      : { previousStates: input.previousStates }),
    projection: input.projection,
    state,
  });
}

export async function policyBundleAfterMutation(input: {
  readonly mutation: PutPrincipalPolicyRequest;
  readonly previous: PrincipalPolicyBundleResponse;
}): Promise<PrincipalPolicyMutationResponse> {
  return {
    ...(await principalPolicyBundleFromState({
      createdAt: input.mutation.state.signedAt,
      encryptedPayload: input.mutation.encryptedPayload,
      memberEnvelopes: input.mutation.memberEnvelopes,
      previousStates: [
        ...input.previous.previousStates,
        {
          state: input.previous.currentState,
          projection: input.previous.currentProjection,
          grants: input.previous.currentGrants,
        },
      ],
      grants: input.mutation.grants,
      projection: input.mutation.projection,
      state: input.mutation.state,
    })),
    containerMutations: [],
  };
}

export async function policyBundleFromInitialRequest(
  request: Awaited<ReturnType<typeof buildInitialGroupPolicyRequest>>,
): Promise<PrincipalPolicyBundleResponse> {
  return principalPolicyBundleFromState({
    createdAt: "2026-05-12T12:00:00.000Z",
    encryptedPayload: request.initialGroupPolicy.encryptedPayload,
    memberEnvelopes: request.initialGroupPolicy.memberEnvelopes,
    grants: request.initialGroupPolicy.grants,
    principalId: request.groupId,
    projection: request.initialGroupPolicy.projection,
    state: request.initialGroupPolicy.state,
  });
}

export async function organizationPolicyBundleFromInitialRequest(
  organizationId: string,
  request: Awaited<ReturnType<typeof buildInitialOrganizationPolicyRequest>>,
): Promise<PrincipalPolicyBundleResponse> {
  return principalPolicyBundleFromState({
    createdAt: "2026-05-12T12:00:00.000Z",
    encryptedPayload: request.encryptedPayload,
    memberEnvelopes: request.memberEnvelopes,
    grants: request.grants,
    principalId: organizationId,
    projection: request.projection,
    state: request.state,
  });
}
