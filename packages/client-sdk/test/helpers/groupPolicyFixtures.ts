import type { ContainerMutationAuthor } from "@tearleads/client-sdk";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  type generateKemSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

export async function createSuccessorGroupPolicyBundle(input: {
  readonly author: ContainerMutationAuthor;
  readonly groupId: string;
  readonly groupKem: ReturnType<typeof generateKemSeedAndKeyPair>;
  readonly keyEpoch?: number | undefined;
  readonly memberPublicKey: Uint8Array;
  readonly previousBundle: PrincipalPolicyBundleResponse;
  readonly signedAt: string;
  readonly userId: string;
}): Promise<PrincipalPolicyBundleResponse> {
  const previousState = input.previousBundle.currentState;
  const version = previousState.version + 1;
  const keyEpoch = input.keyEpoch ?? previousState.keyEpoch + 1;
  const projection = [{ userId: input.userId, role: "admin" as const }];
  const payloadCiphertext = `${input.groupId}-payload-${version}`;
  const [wrappedMember] = await wrapDekForRecipients(input.groupKem.secretKey, [
    input.memberPublicKey,
  ]);
  if (!wrappedMember) {
    throw new Error("Expected group member envelope");
  }
  const memberEnvelopes = [
    {
      userId: input.userId,
      memberKeyFingerprint: wrappedMember.keyFingerprint,
      kemCipherText: bytesToBase64(wrappedMember.kemCipherText),
      wrappedKey: bytesToBase64(wrappedMember.wrappedKey),
    },
  ];
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: input.groupId,
      version,
      prevStateHash: previousState.stateHash,
      keyEpoch,
      encapsulationPublicKey: bytesToBase64(input.groupKem.publicKey),
      keyFingerprint: await toFingerprint(input.groupKem.publicKey),
      members: [{ userId: input.userId }],
      memberEnvelopes,
      projection,
      payloadCiphertext,
      externalAuthority: null,
      signedAt: input.signedAt,
      signerUserId: input.userId,
      signerUserKeyFingerprint: input.author.signerKeyFingerprint,
    }),
    input.author.signerPrivateKey,
  );
  const stateHash = await computePrincipalStateHash(state);

  return {
    currentState: { ...state, stateHash, createdAt: input.signedAt },
    currentPayload: {
      principalType: "group",
      principalId: input.groupId,
      stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
      createdAt: input.signedAt,
    },
    currentProjection: projection,
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: input.groupId,
      stateHash,
      epoch: keyEpoch,
      envelopes: memberEnvelopes,
    },
    previousStates: [
      ...input.previousBundle.previousStates,
      {
        state: input.previousBundle.currentState,
        projection: input.previousBundle.currentProjection,
      },
    ],
  };
}
