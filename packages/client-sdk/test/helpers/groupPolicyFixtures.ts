import type { ContainerMutationAuthor } from "@tearleads/client-sdk";
import {
  type generateKemSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { signedPrincipalPolicyBundle } from "./principalPolicyFixtures";

export async function createSuccessorGroupPolicyBundle(input: {
  readonly author: ContainerMutationAuthor;
  readonly groupId: string;
  readonly groupKem: ReturnType<typeof generateKemSeedAndKeyPair>;
  readonly keyEpoch?: number | undefined;
  readonly memberPublicKey: Uint8Array;
  readonly previousBundle: PrincipalPolicyBundleResponse;
  readonly signedAt: string;
  readonly signerUserId?: string | undefined;
  readonly userId: string;
}): Promise<PrincipalPolicyBundleResponse> {
  const previousState = input.previousBundle.currentState;
  const version = previousState.version + 1;
  const keyEpoch = input.keyEpoch ?? previousState.keyEpoch + 1;
  const [wrappedMember] = await wrapDekForRecipients(input.groupKem.secretKey, [
    input.memberPublicKey,
  ]);
  if (!wrappedMember) {
    throw new Error("Expected group member envelope");
  }

  return signedPrincipalPolicyBundle({
    memberEnvelopes: [
      {
        userId: input.userId,
        memberKeyFingerprint: wrappedMember.keyFingerprint,
        kemCipherText: bytesToBase64(wrappedMember.kemCipherText),
        wrappedKey: bytesToBase64(wrappedMember.wrappedKey),
      },
    ],
    payloadCiphertext: `${input.groupId}-payload-${version}`,
    previousStates: [
      ...input.previousBundle.previousStates,
      {
        state: input.previousBundle.currentState,
        projection: input.previousBundle.currentProjection,
        grants: input.previousBundle.currentGrants,
      },
    ],
    projection: [{ userId: input.userId, role: "admin" as const }],
    signing: {
      principalType: "group",
      principalId: input.groupId,
      version,
      prevStateHash: previousState.stateHash,
      keyEpoch,
      encapsulationPublicKey: bytesToBase64(input.groupKem.publicKey),
      keyFingerprint: await toFingerprint(input.groupKem.publicKey),
      externalAuthority: null,
      signedAt: input.signedAt,
      signerUserId: input.signerUserId ?? input.userId,
      signerUserKeyFingerprint: input.author.signerKeyFingerprint,
      grants: input.previousBundle.currentGrants,
    },
    signingPrivateKey: input.author.signerPrivateKey,
  });
}
