import {
  type ContainerGrantPrincipalHead,
  type ContainerKekRecipientTarget,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  derivePrincipalRecipientKeyEpochId,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";

export async function wrapRootContainerKeyForUser(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  encapsulationPublicKey: Uint8Array;
  manifestHash: string;
  userId: string;
}): Promise<{
  recipientTarget: ContainerKekRecipientTarget;
  userRecipientKey: ContainerUserRecipientKey;
  wrap: ContainerKeyWrap;
}> {
  const [recipient] = await wrapDekForRecipients(input.containerKey, [
    input.encapsulationPublicKey,
  ]);
  if (!recipient) {
    throw new Error("Failed to wrap root container key for test user");
  }

  const userRecipientKey: ContainerUserRecipientKey = {
    userId: input.userId,
    recipientKeyEpochId: `user:${input.userId}:encapsulation:${recipient.keyFingerprint}`,
    recipientKeyFingerprint: recipient.keyFingerprint,
  };
  const recipientTarget: ContainerKekRecipientTarget = {
    recipientKind: "user",
    recipientId: input.userId,
    recipientKeyEpochId: userRecipientKey.recipientKeyEpochId,
    recipientKeyFingerprint: userRecipientKey.recipientKeyFingerprint,
  };

  return {
    recipientTarget,
    userRecipientKey,
    wrap: {
      containerKeyEpochId: input.containerKeyEpochId,
      recipientKind: "user",
      recipientId: input.userId,
      recipientKeyEpochId: userRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: userRecipientKey.recipientKeyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
      wrapManifestHash: input.manifestHash,
    },
  };
}

export async function wrapRootContainerKeyForManagedPrincipal(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  principalEncapsulationPublicKey: string;
  principalHead: ContainerGrantPrincipalHead;
}): Promise<{
  recipientTarget: ContainerKekRecipientTarget;
  wrap: ContainerKeyWrap;
}> {
  const [recipient] = await wrapDekForRecipients(input.containerKey, [
    base64ToBytes(input.principalEncapsulationPublicKey),
  ]);
  if (!recipient) {
    throw new Error("Failed to wrap root container key for admin group");
  }

  const recipientTarget: ContainerKekRecipientTarget = {
    recipientKind: input.principalHead.principalType,
    recipientId: input.principalHead.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
      input.principalHead,
    ),
    recipientKeyFingerprint: input.principalHead.keyFingerprint,
  };

  return {
    recipientTarget,
    wrap: {
      containerKeyEpochId: input.containerKeyEpochId,
      recipientKind: recipientTarget.recipientKind,
      recipientId: recipientTarget.recipientId,
      recipientKeyEpochId: recipientTarget.recipientKeyEpochId,
      recipientKeyFingerprint: recipientTarget.recipientKeyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
      wrapManifestHash: input.manifestHash,
    },
  };
}
