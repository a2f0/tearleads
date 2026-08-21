import type {
  AccessManifest,
  ContainerDirectGrant,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
} from "@symcrypt/crypto";
import { computeKeyingDomainHash } from "@symcrypt/crypto";

export async function containerKekStoreFixtureHash(
  label: string,
): Promise<string> {
  return computeKeyingDomainHash("symcrypt.keying.access-event-body", {
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
