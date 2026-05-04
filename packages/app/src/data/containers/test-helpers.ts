import { expect } from "bun:test";
import {
  type AccessEvent,
  type ContainerAccessEventBody,
  type ContainerAccessLevel,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerDirectGrant,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerRevokeAccessEventBody,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeContainerKekMaterialId,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  deriveContainerAccessManifest,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type KeyingCanonicalJson,
  signAccessEvent,
  toFingerprint,
  type VerifiedAccessEvent,
  type VerifiedContainerAccessManifest,
  type VerifiedContainerKekState,
  verifyContainerAccessManifest,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { ContainerMutationAuthor } from "./containerRuntime";

export const SIGNED_AT = "2026-04-28T12:00:00.000Z";

interface DeepNonCanonicalRecord {
  next?: DeepNonCanonicalRecord;
  notJson?: undefined;
}

export function createDeepNonCanonicalRecord(
  depth: number,
): DeepNonCanonicalRecord {
  const root: DeepNonCanonicalRecord = {};
  let cursor = root;

  for (let index = 0; index < depth; index += 1) {
    const next: DeepNonCanonicalRecord = {};
    cursor.next = next;
    cursor = next;
  }

  cursor.notJson = undefined;
  return root;
}

export async function createAuthor(input?: {
  organizationId?: string;
  userId?: string;
}): Promise<{
  author: ContainerMutationAuthor;
  signingPublicKey: Uint8Array;
}> {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signerKeyFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );

  return {
    author: {
      organizationId: input?.organizationId ?? "organization-1",
      signerDeviceId: "test-device-1",
      signerKeyFingerprint,
      signerPrivateKey: signingKeyPair.signingPrivateKey,
      signerUserId: input?.userId ?? "user-1",
    },
    signingPublicKey: signingKeyPair.signingPublicKey,
  };
}

async function signContainerEvent(input: {
  body: ContainerAccessEventBody;
  dependencyManifestHashes: readonly string[];
  eventId: string;
  objectId: string;
  organizationId: string;
  previousManifestHash: string | null;
  signer: ContainerMutationAuthor;
}): Promise<{
  event: AccessEvent;
  eventHash: string;
}> {
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: input.eventId,
      eventType: input.body.eventType,
      objectKind: "container",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: input.previousManifestHash,
      dependencyManifestHashes: [...input.dependencyManifestHashes],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signer.signerUserId,
      signerDeviceId: input.signer.signerDeviceId,
      signerKeyFingerprint: input.signer.signerKeyFingerprint,
      signedAt: SIGNED_AT,
    },
    input.signer.signerPrivateKey,
  );

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

export async function createContainerManifestFixture(input: {
  author: ContainerMutationAuthor;
  containerId: string;
  containerKeyEpochId: string;
  directGrants: readonly ContainerDirectGrant[];
  eventId: string;
  metadataDocumentId: string;
  organizationId: string;
  referencedPrincipalHeads: ContainerAccessManifestState["referencedPrincipalHeads"];
}): Promise<VerifiedContainerAccessManifest> {
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: [...input.directGrants],
    referencedPrincipalHeads: [...input.referencedPrincipalHeads],
  };
  const { event, eventHash } = await signContainerEvent({
    body,
    dependencyManifestHashes: [],
    eventId: input.eventId,
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    signer: input.author,
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
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: [...input.directGrants],
    referencedPrincipalHeads: [...input.referencedPrincipalHeads],
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const verified = await verifyContainerAccessManifest({
    event: {
      event,
      body: body as unknown as KeyingCanonicalJson,
      eventHash,
    } as VerifiedAccessEvent,
    expectedManifestHash: manifestHash,
    manifest,
    parentContainerPath: [],
    previousManifest: null,
    principalPolicies: [],
  });
  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

export async function createContainerRevokeManifestFixture(input: {
  author: ContainerMutationAuthor;
  containerId: string;
  containerKeyEpochId: string;
  eventId: string;
  organizationId: string;
  previousManifest: VerifiedContainerAccessManifest;
  subjectId: string;
  subjectType: ContainerRevokeAccessEventBody["subjectType"];
}): Promise<VerifiedContainerAccessManifest> {
  const body: ContainerRevokeAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId: input.containerKeyEpochId,
    subjectId: input.subjectId,
    subjectType: input.subjectType,
  };
  const { event, eventHash } = await signContainerEvent({
    body,
    dependencyManifestHashes: [input.previousManifest.manifestHash],
    eventId: input.eventId,
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: input.previousManifest.manifestHash,
    signer: input.author,
  });
  const state: ContainerAccessManifestState = {
    ...input.previousManifest.state,
    epoch: input.previousManifest.state.epoch + 1,
    previousManifestHash: input.previousManifest.manifestHash,
    eventHash,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: input.previousManifest.state.directGrants.filter(
      (grant) =>
        grant.subjectType !== input.subjectType ||
        grant.subjectId !== input.subjectId,
    ),
    referencedPrincipalHeads:
      input.subjectType === "user"
        ? [...input.previousManifest.state.referencedPrincipalHeads]
        : input.previousManifest.state.referencedPrincipalHeads.filter(
            (head) =>
              head.principalType !== input.subjectType ||
              head.principalId !== input.subjectId,
          ),
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const verified = await verifyContainerAccessManifest({
    event: {
      event,
      body: body as unknown as KeyingCanonicalJson,
      eventHash,
    } as VerifiedAccessEvent,
    expectedManifestHash: manifestHash,
    manifest,
    previousContainerPath: [input.previousManifest],
    previousManifest: input.previousManifest,
    principalPolicies: [],
  });
  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

export async function createUserContainerWrap(input: {
  containerKeyEpochId: string;
  containerKek: Uint8Array;
  publicKey: Uint8Array;
  recipientKeyEpochId: string;
  userId: string;
  wrapManifestHash: string;
}) {
  const [recipient] = await wrapDekForRecipients(input.containerKek, [
    input.publicKey,
  ]);
  if (!recipient) {
    throw new Error("Expected recipient wrap");
  }

  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "user" as const,
    recipientId: input.userId,
    recipientKeyEpochId: input.recipientKeyEpochId,
    recipientKeyFingerprint: recipient.keyFingerprint,
    kemCipherText: bytesToBase64(recipient.kemCipherText),
    wrappedKey: bytesToBase64(recipient.wrappedKey),
    wrapManifestHash: input.wrapManifestHash,
  };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: test fixture
export async function createParentProjection(input?: {
  existingUserRecipient?: {
    accessLevel: ContainerAccessLevel;
    publicKey: Uint8Array;
    recipientKeyEpochId: string;
    userId: string;
  };
}): Promise<{
  author: ContainerMutationAuthor;
  encapsulationPublicKey: Uint8Array;
  parentContainerKek: Uint8Array;
  parentKekState: VerifiedContainerKekState;
  projection: ContainerWriterProjectionResponse;
  secretKey: Uint8Array;
  signingPublicKey: Uint8Array;
  userId: string;
}> {
  const userId = "user-1";
  const organizationId = "organization-1";
  const containerId = "parent-container";
  const keyPair = generateKemSeedAndKeyPair();
  const parentContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId,
    keyEpoch: 1,
    keyMaterial: parentContainerKek,
  });
  const { author, signingPublicKey } = await createAuthor({
    organizationId,
    userId,
  });
  const parentManifest = await createContainerManifestFixture({
    author,
    containerId,
    containerKeyEpochId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: userId,
        accessLevel: "admin",
      },
      ...(input?.existingUserRecipient
        ? [
            {
              subjectType: "user" as const,
              subjectId: input.existingUserRecipient.userId,
              accessLevel: input.existingUserRecipient.accessLevel,
            },
          ]
        : []),
    ],
    eventId: "parent-container-event-1",
    metadataDocumentId: "parent-container-metadata-document",
    organizationId,
    referencedPrincipalHeads: [],
  });
  const recipientKeyFingerprint = await toFingerprint(keyPair.publicKey);
  const recipientKeyEpochId = `user:${userId}:encapsulation:${recipientKeyFingerprint}`;
  const wrap = await createUserContainerWrap({
    containerKeyEpochId,
    containerKek: parentContainerKek,
    publicKey: keyPair.publicKey,
    recipientKeyEpochId,
    userId,
    wrapManifestHash: parentManifest.manifestHash,
  });
  const keyEpoch: ContainerKeyEpoch = {
    id: containerKeyEpochId,
    containerId,
    keyEpoch: 1,
    accessManifestHash: parentManifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: parentManifest.event.eventHash,
    createdByManifestHash: parentManifest.manifestHash,
  };
  const recipientTargets: ContainerKekRecipientTarget[] = [
    {
      recipientKind: "user",
      recipientId: userId,
      recipientKeyEpochId,
      recipientKeyFingerprint: wrap.recipientKeyFingerprint,
    },
  ];
  const wraps = [wrap];
  if (input?.existingUserRecipient) {
    const existingWrap = await createUserContainerWrap({
      containerKeyEpochId,
      containerKek: parentContainerKek,
      publicKey: input.existingUserRecipient.publicKey,
      recipientKeyEpochId: input.existingUserRecipient.recipientKeyEpochId,
      userId: input.existingUserRecipient.userId,
      wrapManifestHash: parentManifest.manifestHash,
    });
    recipientTargets.push({
      recipientKind: "user",
      recipientId: input.existingUserRecipient.userId,
      recipientKeyEpochId: input.existingUserRecipient.recipientKeyEpochId,
      recipientKeyFingerprint: existingWrap.recipientKeyFingerprint,
    });
    wraps.push(existingWrap);
  }
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  const parentKekState = {
    containerId,
    accessManifestHash: parentManifest.manifestHash,
    containerKeyEpochId,
    containerKeyEpoch: 1,
    keyEpoch,
    keyEpochHash,
    keyTargetHash:
      await computeContainerKekRecipientTargetHash(recipientTargets),
    parentContainerKeyEpochId: null,
    recipientTargets,
    wraps,
  } as unknown as VerifiedContainerKekState;

  return {
    author,
    encapsulationPublicKey: keyPair.publicKey,
    parentContainerKek,
    parentKekState,
    projection: {
      containerId,
      organizationId,
      path: [
        parentManifest as unknown as ContainerWriterProjectionResponse["path"][number],
      ],
      containerKeks: [
        parentKekState as unknown as ContainerWriterProjectionResponse["containerKeks"][number],
      ],
    },
    secretKey: keyPair.secretKey,
    signingPublicKey,
    userId,
  };
}

export function createParentProjectionUserKeyResolver(
  parent: Awaited<ReturnType<typeof createParentProjection>>,
) {
  return async (userId: string) =>
    userId === parent.userId
      ? {
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingPublicKey: parent.signingPublicKey,
          userId,
        }
      : null;
}

export async function createMutationResponseFromRequest(
  request: ContainerMutationRequest,
): Promise<ContainerMutationResponse> {
  const event = request.event as unknown as AccessEvent;
  const body = request.body as ContainerCreateAccessEventBody;
  const keyEpoch = request.keyEpoch as unknown as ContainerKeyEpoch;

  return {
    containerId: event.objectId,
    organizationId: event.organizationId,
    parentId: body.parentContainerId,
    manifestHead: {
      epoch: 1,
      manifestHash: request.expectedManifestHash,
    },
    accessManifest: {
      event: {
        event: request.event,
        body: request.body as Record<string, unknown>,
        eventHash: await computeAccessEventHash(event),
      },
      manifest: request.manifest,
      manifestHash: request.expectedManifestHash,
      state: {},
    },
    containerKek: {
      containerId: event.objectId,
      accessManifestHash: request.expectedManifestHash,
      containerKeyEpochId: keyEpoch.id,
      containerKeyEpoch: keyEpoch.keyEpoch,
      keyEpoch: request.keyEpoch,
      keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
      keyTargetHash: "test-key-target-hash",
      parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
      recipientTargets: [{}],
      wraps: request.wraps,
    },
    referencedPrincipalHeads: [],
  };
}
