import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
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
import { memberEnvelopesForProjection } from "./principalPolicyMemberEnvelopeFixtures";
import { trustedUserIdentityFromResponse } from "./trustedUserIdentity";

type CacheReferencedPoliciesOptions = Omit<
  CacheReferencedPrincipalPoliciesOptions,
  "resolveTrustedUserIdentity"
> & {
  readonly getUserIdentity: (
    userId: string,
  ) => Promise<UserIdentityResponse | null>;
};

export function cacheReferencedPolicies(
  options: CacheReferencedPoliciesOptions,
): Promise<void> {
  const { getUserIdentity, ...cacheOptions } = options;
  return cacheReferencedPrincipalPolicies({
    ...cacheOptions,
    resolveTrustedUserIdentity: async (userId) => {
      const response = await getUserIdentity(userId);
      return response ? trustedUserIdentityFromResponse(response) : null;
    },
  });
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
  const stateHash = await computePrincipalStateHash(input.policy.state);

  return {
    currentState: {
      ...input.policy.state,
      createdAt: "2026-04-08T00:00:00.000Z",
      stateHash,
    },
    currentPayload: {
      principalType: input.policy.state.principalType,
      principalId: input.principalId,
      stateHash,
      cipherSuite: input.policy.encryptedPayload.cipherSuite,
      ciphertext: input.policy.encryptedPayload.ciphertext,
      ciphertextHash: input.policy.encryptedPayload.ciphertextHash,
      createdAt: "2026-04-08T00:00:00.000Z",
    },
    currentProjection: input.policy.projection,
    currentMemberEnvelopes: {
      principalType: input.policy.state.principalType,
      principalId: input.principalId,
      stateHash,
      epoch: input.policy.state.keyEpoch,
      envelopes: input.policy.memberEnvelopes,
    },
    previousStates: [],
  };
}

export async function createPrincipalPolicyBundle(): Promise<{
  bundle: PrincipalPolicyBundleResponse;
  signerKeyResponse: {
    userId: string;
    signingPublicKey: string;
    signingKeyFingerprint: string;
    encapsulationPublicKey: string;
    encapsulationKeyFingerprint: string;
  };
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
  const payloadCiphertext = "ciphertext-1";
  const memberEnvelopes = await memberEnvelopesForProjection(currentProjection);
  const signedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: "group-1",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: currentProjection.map((member) => ({
        principalType: member.memberPrincipalType,
        principalId: member.userId,
      })),
      memberEnvelopes,
      projection: currentProjection,
      payloadCiphertext,
      externalAuthority: null,
      signedAt: "2026-04-08T00:00:00.000Z",
      signerUserId,
      signerUserKeyFingerprint,
    }),
    signingPrivateKey,
  );
  const stateHash = await computePrincipalStateHash(signedState);
  const bundle: PrincipalPolicyBundleResponse = {
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: "group-1",
      stateHash,
      epoch: 1,
      envelopes: memberEnvelopes,
    },
    currentState: {
      ...signedState,
      createdAt: "2026-04-08T00:00:00.000Z",
      stateHash,
    },
    currentProjection,
    currentPayload: {
      principalType: "group",
      principalId: "group-1",
      stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: signedState.payloadCiphertextHash,
      createdAt: "2026-04-08T00:00:00.000Z",
    },
    previousStates: [],
  };

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
  signerKeyResponse: {
    userId: string;
    signingPublicKey: string;
    signingKeyFingerprint: string;
    encapsulationPublicKey: string;
    encapsulationKeyFingerprint: string;
  };
}> {
  const principalKem = generateKemSeedAndKeyPair();
  const principalKeyFingerprint = await toFingerprint(principalKem.publicKey);
  const signerUserId = "signer-user-1";
  const { signingPublicKey: signerPublicKey, signingPrivateKey } =
    generateSigningSeedAndKeyPair();
  const signerUserKeyFingerprint = await toFingerprint(signerPublicKey);
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
  const previousPayloadCiphertext = "ciphertext-1";
  const previousMemberEnvelopes =
    await memberEnvelopesForProjection(previousProjection);
  const previousSignedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: "group-1",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: previousProjection.map((member) => ({
        principalType: member.memberPrincipalType,
        principalId: member.userId,
      })),
      memberEnvelopes: previousMemberEnvelopes,
      projection: previousProjection,
      payloadCiphertext: previousPayloadCiphertext,
      externalAuthority: null,
      signedAt: "2026-04-08T00:00:00.000Z",
      signerUserId,
      signerUserKeyFingerprint,
    }),
    signingPrivateKey,
  );
  const previousStateHash =
    await computePrincipalStateHash(previousSignedState);
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
  const currentPayloadCiphertext = "ciphertext-2";
  const currentMemberEnvelopes =
    await memberEnvelopesForProjection(currentProjection);
  const currentSignedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: "group-1",
      version: 2,
      prevStateHash: previousStateHash,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: currentProjection.map((member) => ({
        principalType: member.memberPrincipalType,
        principalId: member.userId,
      })),
      memberEnvelopes: currentMemberEnvelopes,
      projection: currentProjection,
      payloadCiphertext: currentPayloadCiphertext,
      externalAuthority: null,
      signedAt: "2026-04-08T00:01:00.000Z",
      signerUserId,
      signerUserKeyFingerprint,
    }),
    signingPrivateKey,
  );
  const currentStateHash = await computePrincipalStateHash(currentSignedState);

  return {
    bundle: {
      currentMemberEnvelopes: {
        principalType: "group",
        principalId: "group-1",
        stateHash: currentStateHash,
        epoch: 1,
        envelopes: currentMemberEnvelopes,
      },
      currentState: {
        ...currentSignedState,
        createdAt: "2026-04-08T00:01:00.000Z",
        stateHash: currentStateHash,
      },
      currentProjection,
      currentPayload: {
        principalType: "group",
        principalId: "group-1",
        stateHash: currentStateHash,
        cipherSuite: "aes-256-gcm",
        ciphertext: currentPayloadCiphertext,
        ciphertextHash: currentSignedState.payloadCiphertextHash,
        createdAt: "2026-04-08T00:01:00.000Z",
      },
      previousStates: [
        {
          state: {
            ...previousSignedState,
            createdAt: "2026-04-08T00:00:00.000Z",
            stateHash: previousStateHash,
          },
          projection: previousProjection,
        },
      ],
    },
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
  const previousPayloadCiphertext = "ciphertext-1";
  const previousMemberEnvelopes =
    await memberEnvelopesForProjection(previousProjection);
  const previousSignedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: "group-1",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: previousProjection.map((member) => ({
        principalType: member.memberPrincipalType,
        principalId: member.userId,
      })),
      memberEnvelopes: previousMemberEnvelopes,
      projection: previousProjection,
      payloadCiphertext: previousPayloadCiphertext,
      externalAuthority: null,
      signedAt: "2026-04-08T00:00:00.000Z",
      signerUserId: adminUserId,
      signerUserKeyFingerprint: adminSigningKeyFingerprint,
    }),
    adminSigningPrivateKey,
  );
  const previousStateHash =
    await computePrincipalStateHash(previousSignedState);
  const currentProjection = [
    {
      userId: outsiderUserId,
      role: "admin" as const,
    },
  ];
  const currentPayloadCiphertext = "ciphertext-2";
  const currentMemberEnvelopes =
    await memberEnvelopesForProjection(currentProjection);
  const currentSignedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: "group-1",
      version: 2,
      prevStateHash: previousStateHash,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: [{ principalType: "user", principalId: outsiderUserId }],
      memberEnvelopes: currentMemberEnvelopes,
      projection: currentProjection,
      payloadCiphertext: currentPayloadCiphertext,
      externalAuthority: null,
      signedAt: "2026-04-08T00:01:00.000Z",
      signerUserId: outsiderUserId,
      signerUserKeyFingerprint: outsiderSigningKeyFingerprint,
    }),
    outsiderSigningPrivateKey,
  );
  const currentStateHash = await computePrincipalStateHash(currentSignedState);

  return {
    bundle: {
      currentMemberEnvelopes: {
        principalType: "group",
        principalId: "group-1",
        stateHash: currentStateHash,
        epoch: 1,
        envelopes: currentMemberEnvelopes,
      },
      currentState: {
        ...currentSignedState,
        createdAt: "2026-04-08T00:01:00.000Z",
        stateHash: currentStateHash,
      },
      currentProjection,
      currentPayload: {
        principalType: "group",
        principalId: "group-1",
        stateHash: currentStateHash,
        cipherSuite: "aes-256-gcm",
        ciphertext: currentPayloadCiphertext,
        ciphertextHash: currentSignedState.payloadCiphertextHash,
        createdAt: "2026-04-08T00:01:00.000Z",
      },
      previousStates: [
        {
          state: {
            ...previousSignedState,
            createdAt: "2026-04-08T00:00:00.000Z",
            stateHash: previousStateHash,
          },
          projection: previousProjection,
        },
      ],
    },
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
