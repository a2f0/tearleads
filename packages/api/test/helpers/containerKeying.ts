import type {
  ContainerKeyEpoch,
  ContainerKeyWrap,
  KekRecipientKind,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";

export function createContainerKeyEpoch(input: {
  readonly containerKeyEpochId: string;
  readonly keyEpoch: number;
  readonly manifest: AccessManifestBundleWire;
  readonly parentKekState: VerifiedContainerKekState | null;
}): ContainerKeyEpoch {
  const manifest = input.manifest as unknown as VerifiedContainerAccessManifest;

  return {
    id: input.containerKeyEpochId,
    containerId: manifest.state.containerId,
    keyEpoch: input.keyEpoch,
    accessManifestHash: manifest.manifestHash,
    parentContainerKeyEpochId:
      input.parentKekState?.containerKeyEpochId ?? null,
    createdByEventHash: manifest.event.eventHash,
    createdByManifestHash: manifest.manifestHash,
  };
}

export function createContainerKeyWrap(input: {
  readonly containerKeyEpochId: string;
  readonly recipientId: string;
  readonly recipientKeyEpochId: string;
  readonly recipientKeyFingerprint: string;
  readonly recipientKind: KekRecipientKind;
  readonly wrapManifestHash: string;
}): ContainerKeyWrap {
  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: input.recipientKind,
    recipientId: input.recipientId,
    recipientKeyEpochId: input.recipientKeyEpochId,
    recipientKeyFingerprint: input.recipientKeyFingerprint,
    kemCipherText: `kem:${input.containerKeyEpochId}:${input.recipientId}`,
    wrappedKey: `wrapped:${input.containerKeyEpochId}:${input.recipientId}`,
    wrapManifestHash: input.wrapManifestHash,
  };
}
