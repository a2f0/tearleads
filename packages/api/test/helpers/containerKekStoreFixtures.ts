import type {
  AccessManifest,
  ContainerDirectGrant,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { computeKeyingDomainHash } from "@tearleads/crypto";
import { containerWrappingPublicKeyForTest } from "@tearleads/crypto/container-wrapping-test-fixtures";

export async function containerKekStoreFixtureHash(
  label: string,
): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.access-event-body", {
    fixture: label,
  });
}

export async function createContainerKekStoreManifestFixture(input: {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly directGrants: readonly ContainerDirectGrant[];
  readonly epoch?: number;
  readonly organizationId?: string;
  readonly previousManifestHash?: string | null;
  readonly referencedPrincipalHeads?: readonly ReferencedPrincipalHead[];
  readonly salt?: string;
}): Promise<VerifiedContainerAccessManifest> {
  const organizationId = input.organizationId ?? crypto.randomUUID();
  const eventHash = await containerKekStoreFixtureHash(
    `${input.salt ?? input.containerId}:event:${input.epoch ?? 1}`,
  );
  const manifest: AccessManifest = {
    version: 1,
    objectKind: "container",
    objectId: input.containerId,
    organizationId,
    epoch: input.epoch ?? 1,
    previousManifestHash: input.previousManifestHash ?? null,
    eventHash,
    structuralHash: await containerKekStoreFixtureHash(
      `${input.containerId}:structural`,
    ),
    grantRoot: await containerKekStoreFixtureHash(
      `${input.containerId}:grant-root`,
    ),
    referencedPrincipalHeads: [...(input.referencedPrincipalHeads ?? [])],
    keyTargetHash: await containerKekStoreFixtureHash(
      `${input.containerId}:key-target`,
    ),
  };
  const manifestHash = await containerKekStoreFixtureHash(
    `${input.salt ?? input.containerId}:manifest:${input.epoch ?? 1}`,
  );

  return {
    manifest,
    manifestHash,
    event: {
      eventHash,
      event: { eventHash },
    } as unknown as VerifiedAccessEvent,
    state: {
      containerKeyPublicKey: containerWrappingPublicKeyForTest(
        input.containerKeyEpochId,
      ),
      systemSlot: null,
      version: 1,
      containerId: input.containerId,
      organizationId,
      epoch: input.epoch ?? 1,
      previousManifestHash: input.previousManifestHash ?? null,
      eventHash,
      parentContainerId: null,
      parentManifestHash: null,
      metadataDocumentId: `${input.containerId}-metadata-document`,
      containerKeyEpochId: input.containerKeyEpochId,
      directGrants: [...input.directGrants],
      referencedPrincipalHeads: [...(input.referencedPrincipalHeads ?? [])],
    },
  } as unknown as VerifiedContainerAccessManifest;
}

export async function createContainerKekStoreUserKey(
  userId: string,
): Promise<ContainerUserRecipientKey> {
  const recipientKeyFingerprint = await containerKekStoreFixtureHash(userId);
  return {
    userId,
    recipientKeyFingerprint,
    recipientKeyEpochId: `user:${userId}:encapsulation:${recipientKeyFingerprint}`,
  };
}

export async function createContainerKekStoreKeyEpoch(input: {
  readonly createdByManifest?: VerifiedContainerAccessManifest;
  readonly keyEpoch: number;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<ContainerKeyEpoch> {
  const createdByManifest = input.createdByManifest ?? input.manifest;
  const containerKeyEpochId = input.manifest.state.containerKeyEpochId;

  if (!containerKeyEpochId) {
    throw new Error("Container manifest fixture is missing a key epoch id");
  }

  return {
    id: containerKeyEpochId,
    containerId: input.manifest.state.containerId,
    keyEpoch: input.keyEpoch,
    accessManifestHash: createdByManifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: createdByManifest.event.eventHash,
    createdByManifestHash: createdByManifest.manifestHash,
  };
}

export async function createContainerKekStoreKeyWrap(input: {
  readonly containerKeyEpochId: string;
  readonly recipientId: string;
  readonly recipientKeyEpochId: string;
  readonly recipientKeyFingerprint: string;
  readonly recipientKind?: ContainerKeyWrap["recipientKind"];
  readonly wrapManifestHash: string;
}): Promise<ContainerKeyWrap> {
  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: input.recipientKind ?? "user",
    recipientId: input.recipientId,
    recipientKeyEpochId: input.recipientKeyEpochId,
    recipientKeyFingerprint: input.recipientKeyFingerprint,
    kemCipherText: `kem:${await containerKekStoreFixtureHash(
      `${input.recipientId}:${input.recipientKeyEpochId}:kem`,
    )}`,
    wrappedKey: `wrapped:${await containerKekStoreFixtureHash(
      `${input.recipientId}:${input.recipientKeyEpochId}:wrapped`,
    )}`,
    wrapManifestHash: input.wrapManifestHash,
  };
}
