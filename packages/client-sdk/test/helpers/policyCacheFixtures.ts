import {
  AES_GCM_TAG_BYTES,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  ML_KEM1024_CIPHERTEXT_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
  type PrincipalProjectionMember,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
  UserIdentityResponse,
} from "@tearleads/validators/response";
import type { buildInitialGroupPolicyRequest } from "../../src/workflows/organizations/principalPolicy";
import {
  type CacheReferencedPrincipalPoliciesOptions,
  cacheReferencedPrincipalPolicies,
} from "../../src/workflows/principals/policyCache";
import type { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import {
  principalPolicyBundleFromState,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";
import { createMockApiTrustedUserIdentityResolver } from "./trustedUserIdentity";

type CacheReferencedPoliciesOptions = Omit<
  CacheReferencedPrincipalPoliciesOptions,
  "reportSecurityIncident" | "resolveTrustedUserIdentity"
> & {
  readonly getUserIdentity: (
    userId: string,
  ) => Promise<UserIdentityResponse | null>;
  readonly reportSecurityIncident?:
    | CacheReferencedPrincipalPoliciesOptions["reportSecurityIncident"]
    | undefined;
};

export function cacheReferencedPolicies(
  options: CacheReferencedPoliciesOptions,
): Promise<void> {
  const { getUserIdentity, reportSecurityIncident, ...cacheOptions } = options;
  return cacheReferencedPrincipalPolicies({
    ...cacheOptions,
    reportSecurityIncident: reportSecurityIncident ?? (async () => undefined),
    resolveTrustedUserIdentity:
      createMockApiTrustedUserIdentityResolver(getUserIdentity),
  });
}

async function memberEnvelopesForProjection(
  projection: readonly PrincipalProjectionMember[],
) {
  return Promise.all(
    projection.map(async (member, index) => ({
      userId: member.userId,
      memberKeyFingerprint: await toFingerprint(
        new TextEncoder().encode(member.userId),
      ),
      kemCipherText: bytesToBase64(
        new Uint8Array(ML_KEM1024_CIPHERTEXT_BYTES).fill(index + 1),
      ),
      wrappedKey: bytesToBase64(
        new Uint8Array(ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES).fill(
          index + 1,
        ),
      ),
    })),
  );
}

type InitialPrincipalPolicy =
  | Awaited<
      ReturnType<typeof buildInitialGroupPolicyRequest>
    >["initialGroupPolicy"]
  | Awaited<ReturnType<typeof buildInitialOrganizationPolicyRequest>>;

export async function principalPolicyBundleFromInitialPolicy(input: {
  readonly principalId: string;
  readonly policy: InitialPrincipalPolicy;
}): Promise<PrincipalPolicyBundleResponse> {
  return principalPolicyBundleFromState({
    createdAt: "2026-04-08T00:00:00.000Z",
    encryptedPayload: input.policy.encryptedPayload,
    memberEnvelopes: input.policy.memberEnvelopes,
    principalId: input.principalId,
    projection: input.policy.projection,
    state: input.policy.state,
  });
}

/** Rebuilds the head bundle a successor's previous state was served from. */
export function predecessorBundleFromSuccessor(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse {
  const previous = bundle.previousStates[0];
  if (!previous) {
    throw new Error("Expected successor bundle to include previous state.");
  }

  return {
    currentMemberEnvelopes: {
      principalType: previous.state.principalType,
      principalId: previous.state.principalId,
      stateHash: previous.state.stateHash,
      epoch: previous.state.keyEpoch,
      envelopes: [],
    },
    currentPayload: {
      principalType: previous.state.principalType,
      principalId: previous.state.principalId,
      stateHash: previous.state.stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: "cached-previous-ciphertext",
      ciphertextHash: previous.state.payloadCiphertextHash,
      createdAt: previous.state.createdAt,
    },
    currentProjection: previous.projection,
    currentState: previous.state,
    previousStates: [],
  };
}

interface PolicySignerKeyResponse {
  userId: string;
  signingPublicKey: string;
  signingKeyFingerprint: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
}

export async function createPrincipalPolicyBundle(): Promise<{
  bundle: PrincipalPolicyBundleResponse;
  signerKeyResponse: PolicySignerKeyResponse;
}> {
  const principalKem = generateKemSeedAndKeyPair();
  const principalKeyFingerprint = await toFingerprint(principalKem.publicKey);
  const signerUserId = "signer-user-1";
  const { signingPublicKey: signerPublicKey, signingPrivateKey } =
    generateSigningSeedAndKeyPair();
  const signerUserKeyFingerprint = await toFingerprint(signerPublicKey);
  const currentProjection = [
    {
      userId: signerUserId,
      role: "admin" as const,
    },
    {
      userId: "alice",
      role: "member" as const,
    },
  ];
  const bundle = await signedPrincipalPolicyBundle({
    memberEnvelopes: await memberEnvelopesForProjection(currentProjection),
    payloadCiphertext: "ciphertext-1",
    projection: currentProjection,
    signing: {
      principalType: "group",
      principalId: "group-1",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      externalAuthority: null,
      signedAt: "2026-04-08T00:00:00.000Z",
      signerUserId,
      signerUserKeyFingerprint,
    },
    signingPrivateKey,
  });

  return {
    bundle,
    signerKeyResponse: {
      userId: signerUserId,
      signingPublicKey: bytesToBase64(signerPublicKey),
      signingKeyFingerprint: signerUserKeyFingerprint,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      encapsulationKeyFingerprint: principalKeyFingerprint,
    },
  };
}

export async function createSuccessorPrincipalPolicyBundle(
  options: { shrinkWithoutRotation?: boolean } = {},
): Promise<{
  bundle: PrincipalPolicyBundleResponse;
  signerKeyResponse: PolicySignerKeyResponse;
}> {
  const principalKem = generateKemSeedAndKeyPair();
  const principalKeyFingerprint = await toFingerprint(principalKem.publicKey);
  const signerUserId = "signer-user-1";
  const { signingPublicKey: signerPublicKey, signingPrivateKey } =
    generateSigningSeedAndKeyPair();
  const signerUserKeyFingerprint = await toFingerprint(signerPublicKey);
  const signing = {
    principalType: "group" as const,
    principalId: "group-1",
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: principalKeyFingerprint,
    externalAuthority: null,
    signerUserId,
    signerUserKeyFingerprint,
  };
  const previousProjection = [
    {
      userId: signerUserId,
      role: "admin" as const,
    },
    {
      userId: "alice",
      role: "member" as const,
    },
  ];
  const previousBundle = await signedPrincipalPolicyBundle({
    memberEnvelopes: await memberEnvelopesForProjection(previousProjection),
    payloadCiphertext: "ciphertext-1",
    projection: previousProjection,
    signing: {
      ...signing,
      version: 1,
      prevStateHash: null,
      signedAt: "2026-04-08T00:00:00.000Z",
    },
    signingPrivateKey,
  });
  const currentProjection = [
    {
      userId: signerUserId,
      role: "admin" as const,
    },
    ...(options.shrinkWithoutRotation
      ? []
      : [
          {
            userId: "alice",
            role: "member" as const,
          },
        ]),
    {
      userId: "bob",
      role: "member" as const,
    },
  ];
  const bundle = await signedPrincipalPolicyBundle({
    memberEnvelopes: await memberEnvelopesForProjection(currentProjection),
    payloadCiphertext: "ciphertext-2",
    previousStates: [
      { state: previousBundle.currentState, projection: previousProjection },
    ],
    projection: currentProjection,
    signing: {
      ...signing,
      version: 2,
      prevStateHash: previousBundle.currentState.stateHash,
      signedAt: "2026-04-08T00:01:00.000Z",
    },
    signingPrivateKey,
  });

  return {
    bundle,
    signerKeyResponse: {
      userId: signerUserId,
      signingPublicKey: bytesToBase64(signerPublicKey),
      signingKeyFingerprint: signerUserKeyFingerprint,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      encapsulationKeyFingerprint: principalKeyFingerprint,
    },
  };
}

export async function createUnauthorizedSuccessorPrincipalPolicyBundle(): Promise<{
  bundle: PrincipalPolicyBundleResponse;
  signerKeyResponses: Map<string, UserIdentityResponse>;
}> {
  const principalKem = generateKemSeedAndKeyPair();
  const principalKeyFingerprint = await toFingerprint(principalKem.publicKey);
  const adminUserId = "admin-user-1";
  const outsiderUserId = "outsider-user-1";
  const {
    signingPublicKey: adminSigningPublicKey,
    signingPrivateKey: adminSigningPrivateKey,
  } = generateSigningSeedAndKeyPair();
  const {
    signingPublicKey: outsiderSigningPublicKey,
    signingPrivateKey: outsiderSigningPrivateKey,
  } = generateSigningSeedAndKeyPair();
  const adminSigningKeyFingerprint = await toFingerprint(adminSigningPublicKey);
  const outsiderSigningKeyFingerprint = await toFingerprint(
    outsiderSigningPublicKey,
  );
  const signing = {
    principalType: "group" as const,
    principalId: "group-1",
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: principalKeyFingerprint,
    externalAuthority: null,
  };
  const previousProjection = [
    {
      userId: adminUserId,
      role: "admin" as const,
    },
    {
      userId: outsiderUserId,
      role: "member" as const,
    },
  ];
  const previousBundle = await signedPrincipalPolicyBundle({
    memberEnvelopes: await memberEnvelopesForProjection(previousProjection),
    payloadCiphertext: "ciphertext-1",
    projection: previousProjection,
    signing: {
      ...signing,
      version: 1,
      prevStateHash: null,
      signedAt: "2026-04-08T00:00:00.000Z",
      signerUserId: adminUserId,
      signerUserKeyFingerprint: adminSigningKeyFingerprint,
    },
    signingPrivateKey: adminSigningPrivateKey,
  });
  const currentProjection = [
    {
      userId: outsiderUserId,
      role: "admin" as const,
    },
  ];
  const bundle = await signedPrincipalPolicyBundle({
    memberEnvelopes: await memberEnvelopesForProjection(currentProjection),
    payloadCiphertext: "ciphertext-2",
    previousStates: [
      { state: previousBundle.currentState, projection: previousProjection },
    ],
    projection: currentProjection,
    signing: {
      ...signing,
      version: 2,
      prevStateHash: previousBundle.currentState.stateHash,
      signedAt: "2026-04-08T00:01:00.000Z",
      signerUserId: outsiderUserId,
      signerUserKeyFingerprint: outsiderSigningKeyFingerprint,
    },
    signingPrivateKey: outsiderSigningPrivateKey,
  });

  return {
    bundle,
    signerKeyResponses: new Map([
      [
        adminUserId,
        {
          userId: adminUserId,
          signingPublicKey: bytesToBase64(adminSigningPublicKey),
          signingKeyFingerprint: adminSigningKeyFingerprint,
          encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
          encapsulationKeyFingerprint: principalKeyFingerprint,
        },
      ],
      [
        outsiderUserId,
        {
          userId: outsiderUserId,
          signingPublicKey: bytesToBase64(outsiderSigningPublicKey),
          signingKeyFingerprint: outsiderSigningKeyFingerprint,
          encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
          encapsulationKeyFingerprint: principalKeyFingerprint,
        },
      ],
    ]),
  };
}

export function referencedPrincipalStateFromBundle(
  bundle: PrincipalPolicyBundleResponse,
): ReferencedPrincipalStateResponse {
  return referencedPrincipalStateFromPolicyState(bundle.currentState);
}

export function referencedPrincipalStateFromPolicyState(
  state: PrincipalPolicyBundleResponse["currentState"],
): ReferencedPrincipalStateResponse {
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  };
}
