import {
  derivePrincipalRecipientKeyEpochId,
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  wrapDekForRecipients,
} from "@symcrypt/crypto";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import type { PrincipalPolicyBundleResponse } from "@symcrypt/validators/response";
import type { DocumentCreateAuthor } from "../../src/data/documents/shared/types";
import { buildInitialGroupPolicyRequest } from "../../src/workflows/organizations/principalPolicy";
import { createSuccessorGroupPolicyBundle } from "./groupPolicyFixtures";
import {
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";

export async function createManagedContainerWrap(input: {
  bundle: PrincipalPolicyBundleResponse;
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  wrapManifestHash: string;
}) {
  const head = principalPolicyHead(input.bundle);
  if (head.principalType !== "group") {
    throw new Error("Container grants cannot target organizations");
  }
  const [wrapped] = await wrapDekForRecipients(input.containerKey, [
    base64ToBytes(input.bundle.currentState.encapsulationPublicKey),
  ]);
  if (!wrapped) {
    throw new Error("Expected managed-principal container wrap");
  }

  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "group" as const,
    recipientId: head.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(head),
    recipientKeyFingerprint: wrapped.keyFingerprint,
    kemCipherText: bytesToBase64(wrapped.kemCipherText),
    wrappedKey: bytesToBase64(wrapped.wrappedKey),
    wrapManifestHash: input.wrapManifestHash,
  };
}

export async function createRotatedGroupPolicy(input: {
  author: DocumentCreateAuthor;
  containerId: string;
  initialMemberKem?: EncapsulationKeyPair | undefined;
  initialUserId?: string | undefined;
  memberKem: EncapsulationKeyPair;
  signingPublicKey: Uint8Array;
  userId: string;
}) {
  const groupId = "cold-login-group";
  const initialUserId = input.initialUserId ?? input.userId;
  const initialRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: input.initialMemberKem ?? input.memberKem,
    grants: [{ accessLevel: "read", containerId: input.containerId }],
    groupId,
    name: "Cold login readers",
    signerUserId: initialUserId,
    signingFingerprint: input.author.signerKeyFingerprint,
    signingKeyPair: {
      signingPrivateKey: input.author.signerPrivateKey,
      signingPublicKey: input.signingPublicKey,
    },
  });
  const initial = await policyBundleFromInitialRequest(initialRequest);
  const current = await createSuccessorGroupPolicyBundle({
    author: input.author,
    groupId,
    groupKem: generateKemSeedAndKeyPair(),
    memberPublicKey: input.memberKem.publicKey,
    previousBundle: initial,
    signedAt: new Date(
      Date.parse(initial.currentState.signedAt) + 1_000,
    ).toISOString(),
    signerUserId: initialUserId,
    userId: input.userId,
  });

  return { current, initial };
}
