import { fixtureHash } from "./canonical.testFixtures";
import type {
  ContainerKeyEpoch,
  ContainerKeyWrap,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedDocumentKekTargets,
  VerifiedDocumentLinkSetManifest,
} from "./index";
import {
  deriveBlobKekTargets,
  deriveDocumentKekTargets,
  verifyContainerKekState,
} from "./index";

export async function createContainerKeyEpochFixture(input: {
  readonly createdByManifest?: VerifiedContainerAccessManifest;
  readonly keyEpoch?: number;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly parentContainerKeyEpochId?: string | null;
}): Promise<ContainerKeyEpoch> {
  const createdByManifest = input.createdByManifest ?? input.manifest;

  if (!input.manifest.state.containerKeyEpochId) {
    throw new Error("Container manifest fixture is missing a key epoch id");
  }

  return {
    id: input.manifest.state.containerKeyEpochId,
    containerId: input.manifest.state.containerId,
    keyEpoch: input.keyEpoch ?? 1,
    accessManifestHash: createdByManifest.manifestHash,
    parentContainerKeyEpochId: input.parentContainerKeyEpochId ?? null,
    createdByEventHash: createdByManifest.event.eventHash,
    createdByManifestHash: createdByManifest.manifestHash,
  };
}

export async function createContainerKeyWrap(input: {
  readonly containerKeyEpochId: string;
  readonly recipientKind: ContainerKeyWrap["recipientKind"];
  readonly recipientId: string;
  readonly recipientKeyEpochId: string;
  readonly recipientKeyFingerprint: string;
  readonly wrapManifestHash: string;
}): Promise<ContainerKeyWrap> {
  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: input.recipientKind,
    recipientId: input.recipientId,
    recipientKeyEpochId: input.recipientKeyEpochId,
    recipientKeyFingerprint: input.recipientKeyFingerprint,
    kemCipherText: `kem:${await fixtureHash(`${input.recipientId}:kem`)}`,
    wrappedKey: `wrapped:${await fixtureHash(`${input.recipientId}:wrapped`)}`,
    wrapManifestHash: input.wrapManifestHash,
  };
}

export async function createVerifiedContainerKekStateFixture(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly recipientUserId: string;
  readonly recipientUserIds?: readonly string[];
}): Promise<VerifiedContainerKekState> {
  const keyEpoch = await createContainerKeyEpochFixture({
    manifest: input.manifest,
  });
  const recipientUserIds = input.recipientUserIds ?? [input.recipientUserId];
  const recipientKeys = await Promise.all(
    recipientUserIds.map(async (userId) => {
      const recipientKeyFingerprint = await fixtureHash(
        `${input.manifest.state.containerId}:${userId}:recipient-key`,
      );
      return {
        userId,
        recipientKeyEpochId: `user:${userId}:encapsulation:${recipientKeyFingerprint}`,
        recipientKeyFingerprint,
      };
    }),
  );
  const result = await verifyContainerKekState({
    containerManifest: input.manifest,
    keyEpoch,
    userRecipientKeys: recipientKeys,
    wraps: await Promise.all(
      recipientKeys.map((recipient) =>
        createContainerKeyWrap({
          containerKeyEpochId: keyEpoch.id,
          recipientKind: "user",
          recipientId: recipient.userId,
          recipientKeyEpochId: recipient.recipientKeyEpochId,
          recipientKeyFingerprint: recipient.recipientKeyFingerprint,
          wrapManifestHash: input.manifest.manifestHash,
        }),
      ),
    ),
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

export async function deriveRequiredDocumentKekTargets(input: {
  readonly containerKekStates: readonly VerifiedContainerKekState[];
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly linkedContainerManifests: readonly VerifiedContainerAccessManifest[];
}): Promise<VerifiedDocumentKekTargets> {
  const result = await deriveDocumentKekTargets(input);
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

export async function deriveRequiredBlobKekTargets(input: {
  readonly activeBindings: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
  readonly containerKekStates: readonly VerifiedContainerKekState[];
  readonly documentManifests: readonly VerifiedDocumentLinkSetManifest[];
  readonly linkedContainerManifests: readonly VerifiedContainerAccessManifest[];
}): Promise<VerifiedBlobKekTargets> {
  const result = await deriveBlobKekTargets(input);
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}
