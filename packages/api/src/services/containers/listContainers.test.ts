import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  type AccessEvent,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  generateKemSeedAndKeyPair,
  type KeyingCanonicalJson,
  type ReferencedPrincipalHead,
  signAccessEvent,
  toFingerprint,
  type UnsignedAccessEvent,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "../../../test/helpers/principalState";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import { storeVerifiedAccessManifest } from "../../access/write/accessManifestStore";
import { storeVerifiedPrincipalState } from "../../access/write/principalStateStore";
import { db } from "../../adapters/postgres";
import { containers, organizations, users } from "../../schema";
import { listContainers } from "./listContainers";

const SIGNED_AT = "2026-04-30T00:00:00.000Z";

function principalReference(
  state: StoredPrincipalState,
): ReferencedPrincipalHead {
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  };
}

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

async function storeGroupPolicy(input: {
  groupId: string;
  keyEpoch: number;
  members: readonly { principalType: "user"; principalId: string }[];
  previousStateHash: string | null;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
  version: number;
}): Promise<StoredPrincipalState> {
  const groupKem = generateKemSeedAndKeyPair();
  const projection = createProjectionWithAdminSigner(
    input.signerUserId,
    input.members,
  );
  const payloadCiphertext = JSON.stringify({ members: projection });
  const bundle = await signPrincipalStateBundle({
    principalType: "group",
    principalId: input.groupId,
    version: input.version,
    prevStateHash: input.previousStateHash,
    keyEpoch: input.keyEpoch,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    members: [
      { principalType: "user", principalId: input.signerUserId },
      ...input.members,
    ],
    projection,
    payloadCiphertext,
    signedAt: SIGNED_AT,
    signerUserId: input.signerUserId,
    signerUserKeyFingerprint: input.signerKeyFingerprint,
    signingPrivateKey: input.signerPrivateKey,
  });

  return storeVerifiedPrincipalState(bundle, db);
}

async function storeContainerWithReferencedGroup(input: {
  containerId: string;
  groupReference: ReferencedPrincipalHead;
  metadataDocumentId: string;
  organizationId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}) {
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants: [
      {
        accessLevel: "read",
        subjectType: "group",
        subjectId: input.groupReference.principalId,
      },
    ],
    referencedPrincipalHeads: [input.groupReference],
  };
  const { event, eventHash } = await signContainerEvent({
    body,
    containerId: input.containerId,
    organizationId: input.organizationId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signerPrivateKey,
    signerUserId: input.signerUserId,
  });
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.containerId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    parentContainerId: null,
    parentManifestHash: null,
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
}

test("listContainers filters managed grants through the manifest-referenced policy head", async () => {
  const owner = createTestUser();
  const member = createTestUser();
  owner.userId = crypto.randomUUID();
  member.userId = crypto.randomUUID();
  owner.fingerprint = await toFingerprint(owner.signing.signingPublicKey);

  const organizationId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const metadataDocumentId = crypto.randomUUID();
  const groupId = crypto.randomUUID();

  await db.insert(organizations).values({
    id: organizationId,
    name: "Manifest Reference Test",
  });
  await db.insert(users).values({
    id: owner.userId,
    fingerprint: owner.fingerprint,
    signingPublicKey: bytesToBase64(owner.signing.signingPublicKey),
    encapsulationPublicKey: bytesToBase64(owner.kem.publicKey),
    encapsulationKeyFingerprint: await toFingerprint(owner.kem.publicKey),
    defaultOrganizationId: organizationId,
  });
  await db.insert(containers).values({
    id: containerId,
    organizationId,
    parentId: null,
  });

  const originalGroupPolicy = await storeGroupPolicy({
    groupId,
    keyEpoch: 1,
    members: [],
    previousStateHash: null,
    signerKeyFingerprint: owner.fingerprint,
    signerPrivateKey: owner.signing.signingPrivateKey,
    signerUserId: owner.userId,
    version: 1,
  });
  await storeGroupPolicy({
    groupId,
    keyEpoch: 2,
    members: [{ principalType: "user", principalId: member.userId }],
    previousStateHash: originalGroupPolicy.stateHash,
    signerKeyFingerprint: owner.fingerprint,
    signerPrivateKey: owner.signing.signingPrivateKey,
    signerUserId: owner.userId,
    version: 2,
  });
  await storeContainerWithReferencedGroup({
    containerId,
    groupReference: principalReference(originalGroupPolicy),
    metadataDocumentId,
    organizationId,
    signerKeyFingerprint: owner.fingerprint,
    signerPrivateKey: owner.signing.signingPrivateKey,
    signerUserId: owner.userId,
  });

  const listed = await listContainers(
    createServiceTestRuntime(),
    member.userId,
  );

  expect(listed.map((container) => container.id)).not.toContain(containerId);
});
