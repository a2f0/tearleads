import { db } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import type { createTestUser } from "@tearleads/bob-and-alice";
import {
  type AccessEvent,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  type KeyingCanonicalJson,
  signAccessEvent,
  type UnsignedAccessEvent,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { storeVerifiedAccessManifest } from "../../src/access/write/accessManifestStore";

const SIGNED_AT = "2026-05-05T00:00:00.000Z";

async function signContainerEvent(input: {
  body: ContainerCreateAccessEventBody;
  containerId: string;
  organizationId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}): Promise<{ event: AccessEvent; eventHash: string }> {
  const unsigned: UnsignedAccessEvent = {
    version: 1,
    eventId: crypto.randomUUID(),
    eventType: "container.create",
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    dependencyManifestHashes: [],
    bodyHash: await computeAccessEventBodyHash(
      input.body as unknown as KeyingCanonicalJson,
    ),
    signerUserId: input.signerUserId,
    signerDeviceId: `signing-key:${input.signerKeyFingerprint}`,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signedAt: SIGNED_AT,
  };
  const event = await signAccessEvent(unsigned, input.signerPrivateKey);

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

export async function storeChildContainerAccessManifest(input: {
  childContainerId: string;
  directGrants?: ContainerCreateAccessEventBody["directGrants"];
  metadataDocumentId: string;
  organizationId: string;
  owner: ReturnType<typeof createTestUser>;
  parentContainerId: string;
  parentManifestHash: string;
  referencedPrincipalHeads?: ContainerCreateAccessEventBody["referencedPrincipalHeads"];
}) {
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants: input.directGrants ?? [],
    referencedPrincipalHeads: input.referencedPrincipalHeads ?? [],
  };
  const { event, eventHash } = await signContainerEvent({
    body,
    containerId: input.childContainerId,
    organizationId: input.organizationId,
    signerKeyFingerprint: input.owner.fingerprint,
    signerPrivateKey: input.owner.signing.signingPrivateKey,
    signerUserId: input.owner.userId,
  });
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.childContainerId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const verifiedManifest: VerifiedContainerAccessManifest = {
    event: {
      event,
      body: body as unknown as KeyingCanonicalJson,
      eventHash,
    },
    manifest,
    manifestHash,
    state,
  } as VerifiedContainerAccessManifest;

  await storeVerifiedAccessManifest({ verifiedManifest }, db);
  return manifestHash;
}

export async function organizationIdForContainer(
  containerId: string,
): Promise<string> {
  const rows = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  const organizationId = rows[0]?.organizationId;
  if (!organizationId) {
    throw new Error(`container ${containerId} has no organization`);
  }
  return organizationId;
}
