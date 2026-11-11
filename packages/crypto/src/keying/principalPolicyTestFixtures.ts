import { expect } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  generateKemSeedAndKeyPair,
  ML_KEM1024_CIPHERTEXT_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
} from "../encapsulation/generateKeyPair";
import { toFingerprint } from "../fingerprint";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  type PrincipalContainerGrant,
  type PrincipalProjectionMember,
  type PrincipalStateExternalAuthority,
  type PrincipalStateMember,
  type PrincipalStateMemberEnvelope,
  signPrincipalState,
} from "../principalState";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { AES_GCM_TAG_BYTES } from "../symmetric";
import { computeUserIdentityBundleFingerprint } from "../userIdentityBundle";
import type {
  KeyingVerificationCode,
  KeyingVerificationResult,
  PrincipalPolicyBundle,
  PrincipalPolicySignedState,
  PrincipalPolicyStateChainEntry,
} from "./index";

export function expectVerificationError<T>(
  result: KeyingVerificationResult<T>,
  code: KeyingVerificationCode,
) {
  if (result.ok) {
    throw new Error("Expected verification to fail");
  }

  expect(result.error.code).toBe(code);
}

export const POLICY_FIXTURE_IDENTITY_TRUST_DOMAIN = "https://api.example.test";

export function policyMember(
  identity: {
    readonly userId: string;
    readonly identityBundleFingerprint: string;
  },
  role: PrincipalProjectionMember["role"] = "member",
): PrincipalProjectionMember {
  return {
    userId: identity.userId,
    role,
    identityBundleFingerprint: identity.identityBundleFingerprint,
  };
}

function projectionWithAdmin(
  signer: Awaited<ReturnType<typeof createPolicySigner>>,
  members: readonly PrincipalStateMember[],
): PrincipalProjectionMember[] {
  if (members.some((member) => member.userId !== signer.userId)) {
    throw new Error(
      "Provide an explicit policyMember projection for every non-signer identity",
    );
  }
  return [policyMember(signer, "admin")];
}

export async function createPolicySigner(
  userId = "user-admin",
  options: {
    readonly identityTrustDomain?: string;
    readonly kemKeyPair?: ReturnType<typeof generateKemSeedAndKeyPair>;
  } = {},
) {
  const signing = generateSigningSeedAndKeyPair();
  const kemKeyPair = options.kemKeyPair ?? generateKemSeedAndKeyPair();
  const identityTrustDomain =
    options.identityTrustDomain ?? POLICY_FIXTURE_IDENTITY_TRUST_DOMAIN;
  return {
    ...signing,
    userId,
    kemKeyPair,
    identityTrustDomain,
    identityBundleFingerprint: await computeUserIdentityBundleFingerprint({
      identityTrustDomain,
      userId,
      signingPublicKey: signing.signingPublicKey,
      encapsulationPublicKey: kemKeyPair.publicKey,
    }),
    encapsulationKeyFingerprint: await toFingerprint(kemKeyPair.publicKey),
    signingKeyFingerprint: await toFingerprint(signing.signingPublicKey),
    signingPublicKey: signing.signingPublicKey,
  };
}

export async function signPolicyState(input: {
  readonly externalAuthority?: PrincipalStateExternalAuthority | null;
  readonly grants?: readonly PrincipalContainerGrant[];
  readonly keyEpoch?: number;
  readonly memberEnvelopes?: readonly PrincipalStateMemberEnvelope[];
  readonly members: readonly PrincipalStateMember[];
  readonly prevStateHash: string | null;
  readonly principalId: string;
  readonly principalKeyPair?: ReturnType<typeof generateKemSeedAndKeyPair>;
  readonly projection?: readonly PrincipalProjectionMember[];
  readonly signedAt?: string;
  readonly signer: Awaited<ReturnType<typeof createPolicySigner>>;
  readonly version: number;
}): Promise<{
  readonly entry: PrincipalPolicyStateChainEntry;
  readonly payload: PrincipalPolicyBundle["currentPayload"];
  readonly memberEnvelopes: readonly PrincipalStateMemberEnvelope[];
  readonly state: PrincipalPolicySignedState;
}> {
  const principalKeyPair =
    input.principalKeyPair ?? generateKemSeedAndKeyPair();
  const projection =
    input.projection ?? projectionWithAdmin(input.signer, input.members);
  // Root-only policy tests do not decrypt these envelopes. Tests authenticating
  // recipient keys must provide memberEnvelopes made with their real identities.
  const memberEnvelopes =
    input.memberEnvelopes ??
    (await Promise.all(
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
    ));
  const payloadCiphertext = JSON.stringify({ members: projection });
  const grants = [...(input.grants ?? [])];
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: input.principalId,
      version: input.version,
      prevStateHash: input.prevStateHash,
      keyEpoch: input.keyEpoch ?? 1,
      encapsulationPublicKey: bytesToBase64(principalKeyPair.publicKey),
      keyFingerprint: await toFingerprint(principalKeyPair.publicKey),
      members: [...input.members],
      memberEnvelopes: [...memberEnvelopes],
      projection: [...projection],
      grants,
      payloadCiphertext,
      externalAuthority: input.externalAuthority ?? null,
      signedAt:
        input.signedAt ??
        `2026-04-26T12:${String(input.version).padStart(2, "0")}:00.000Z`,
      signerUserId: input.signer.userId,
      signerUserKeyFingerprint: input.signer.signingKeyFingerprint,
    }),
    input.signer.signingPrivateKey,
  );
  const stateWithHash = {
    ...state,
    stateHash: await computePrincipalStateHash(state),
  };

  return {
    state: stateWithHash,
    memberEnvelopes,
    entry: {
      state: stateWithHash,
      projection,
      grants,
    },
    payload: {
      principalType: "group",
      principalId: input.principalId,
      stateHash: stateWithHash.stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
    },
  };
}

export function createBundle(input: {
  readonly current: Awaited<ReturnType<typeof signPolicyState>>;
  readonly previous?: readonly PrincipalPolicyStateChainEntry[];
}): PrincipalPolicyBundle {
  return {
    currentState: input.current.state,
    currentPayload: input.current.payload,
    currentProjection: input.current.entry.projection,
    currentGrants: input.current.entry.grants,
    currentMemberEnvelopes: {
      principalType: input.current.state.principalType,
      principalId: input.current.state.principalId,
      stateHash: input.current.state.stateHash,
      epoch: input.current.state.keyEpoch,
      envelopes: input.current.memberEnvelopes,
    },
    previousStates: input.previous ?? [],
  };
}

export { clearPrincipalPolicySignatureCaches } from "./principalPolicySignatures";
