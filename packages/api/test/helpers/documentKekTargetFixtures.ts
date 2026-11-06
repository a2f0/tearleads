import {
  type AccessManifest,
  computeAccessManifestHash,
  type VerifiedContainerAccessManifest,
  verifyAccessManifest,
} from "@tearleads/crypto";
import { containerWrappingPublicKeyForTest } from "@tearleads/crypto/container-wrapping-test-fixtures";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { DocumentKekTargetError } from "../../src/access/read/documentKekTargets";
import { createVerifiedEvent } from "./documentContentKeyStoreFixtures";
import { hashOf } from "./keyingLabelHash";

export const staleLink = (link: string, id: string) =>
  new DocumentKekTargetError(
    `Container KEK ${link} is stale for container ${id}`,
    409,
    DOCUMENT_SYNC_ERROR_CODES.stateStale,
  );

/** A verified container grant manifest whose event carries its KEK public key. */
export async function createVerifiedKeyedContainerManifest(input: {
  readonly containerKeyEpochId?: string;
  readonly containerId: string;
  readonly epoch?: number;
  readonly organizationId: string;
  readonly parentContainerId?: string | null;
  readonly parentManifestHash?: string | null;
  readonly previousManifestHash?: string | null;
  readonly salt: string;
}): Promise<VerifiedContainerAccessManifest> {
  const containerKeyEpochId =
    input.containerKeyEpochId ?? `${input.containerId}:key-epoch-1`;
  const event = await createVerifiedEvent({
    body: {
      containerKeyPublicKey:
        containerWrappingPublicKeyForTest(containerKeyEpochId),
      containerKeyEpochId,
      eventType: "container.grant",
      grant: {
        accessLevel: "read",
        subjectId: crypto.randomUUID(),
        subjectType: "user",
      },
      referencedPrincipalHead: null,
      salt: input.salt,
    },
    eventType: "container.grant",
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: input.previousManifestHash ?? null,
  });
  const manifest: AccessManifest = {
    version: 1,
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.organizationId,
    epoch: input.epoch ?? 1,
    previousManifestHash: input.previousManifestHash ?? null,
    eventHash: event.eventHash,
    structuralHash: await hashOf(`${input.salt}:structural`),
    grantRoot: await hashOf(`${input.salt}:grant-root`),
    referencedPrincipalHeads: [],
    keyTargetHash: await hashOf(`${input.salt}:key-target`),
  };
  const verifiedManifest = await verifyAccessManifest({
    event,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    expectedObject: { objectKind: "container", objectId: input.containerId },
    expectedPreviousManifestHash: input.previousManifestHash ?? null,
    manifest,
  });

  if (!verifiedManifest.ok) {
    throw verifiedManifest.error;
  }

  return {
    ...verifiedManifest.value,
    state: {
      containerKeyPublicKey:
        containerWrappingPublicKeyForTest(containerKeyEpochId),
      systemSlot: null,
      version: 1,
      containerId: input.containerId,
      organizationId: input.organizationId,
      epoch: input.epoch ?? 1,
      previousManifestHash: input.previousManifestHash ?? null,
      eventHash: event.eventHash,
      parentContainerId: input.parentContainerId ?? null,
      parentManifestHash: input.parentManifestHash ?? null,
      metadataDocumentId: `${input.containerId}:metadata`,
      containerKeyEpochId,
      directGrants: [],
      referencedPrincipalHeads: [],
    },
  } as unknown as VerifiedContainerAccessManifest;
}
