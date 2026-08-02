import { expect } from "bun:test";
import type { ContainerMutationAuthor } from "@tearleads/client-sdk";
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
  verifySignedAccessEvent,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { createContainerManifestFixture as createCryptoContainerManifestFixture } from "@tearleads/crypto/test-fixtures";
import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

export { createMutationResponseFromRequest } from "./containerMutationResponseFixtures";

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
  signingPublicKey: Uint8Array;
}): Promise<VerifiedAccessEvent> {
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
  const verified = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingCanonicalJson,
    event,
    signerPublicKey: input.signingPublicKey,
  });

  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
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
  signingPublicKey: Uint8Array;
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
  const verifiedEvent = await signContainerEvent({
    body,
    dependencyManifestHashes: [],
    eventId: input.eventId,
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    signer: input.author,
    signingPublicKey: input.signingPublicKey,
  });
  const fixture = await createCryptoContainerManifestFixture({
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: input.directGrants,
    event: verifiedEvent,
    metadataDocumentId: input.metadataDocumentId,
    organizationId: input.organizationId,
    referencedPrincipalHeads: input.referencedPrincipalHeads,
  });
  const verified = await verifyContainerAccessManifest({
    event: verifiedEvent,
    expectedManifestHash: fixture.manifestHash,
    manifest: fixture.manifest,
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
  keyringHash: string;
  organizationId: string;
  predecessorBridgeHash: string;
  previousManifest: VerifiedContainerAccessManifest;
  subjectId: string;
  subjectType: ContainerRevokeAccessEventBody["subjectType"];
  signingPublicKey: Uint8Array;
}): Promise<VerifiedContainerAccessManifest> {
  const body: ContainerRevokeAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId: input.containerKeyEpochId,
    keyringHash: input.keyringHash,
    predecessorBridgeHash: input.predecessorBridgeHash,
    subjectId: input.subjectId,
    subjectType: input.subjectType,
  };
  const verifiedEvent = await signContainerEvent({
    body,
    dependencyManifestHashes: [input.previousManifest.manifestHash],
    eventId: input.eventId,
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: input.previousManifest.manifestHash,
    signer: input.author,
    signingPublicKey: input.signingPublicKey,
  });
  const state: ContainerAccessManifestState = {
    ...input.previousManifest.state,
    epoch: input.previousManifest.state.epoch + 1,
    previousManifestHash: input.previousManifest.manifestHash,
    eventHash: verifiedEvent.eventHash,
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
    event: verifiedEvent,
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
    signingPublicKey,
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
    containerManifestHistory: [],
    keyring: null,
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
      ? createTestTrustedUserIdentity({
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingKeyFingerprint: parent.author.signerKeyFingerprint,
          signingPublicKey: parent.signingPublicKey,
          userId,
        })
      : null;
}

export async function substituteFirstProjectionUserWrapMaterial(input: {
  projection: ContainerWriterProjectionResponse;
  publicKey: Uint8Array;
  userId: string;
}): Promise<ContainerWriterProjectionResponse> {
  const tamperedProjection = structuredClone(input.projection);
  const kek = tamperedProjection.containerKeks[0];
  if (!kek) {
    throw new Error("Expected projection KEK fixture");
  }
  const target = kek.recipientTargets.find(
    (candidate) =>
      Reflect.get(candidate, "recipientKind") === "user" &&
      Reflect.get(candidate, "recipientId") === input.userId,
  );
  if (!target) {
    throw new Error("Expected projection user recipient target fixture");
  }
  const recipientKeyEpochId = Reflect.get(target, "recipientKeyEpochId");
  if (
    typeof recipientKeyEpochId !== "string" ||
    recipientKeyEpochId.length === 0
  ) {
    throw new Error("Expected projection user recipient key epoch fixture");
  }

  const substituteWrap = await createUserContainerWrap({
    containerKeyEpochId: kek.containerKeyEpochId,
    containerKek: crypto.getRandomValues(new Uint8Array(32)),
    publicKey: input.publicKey,
    recipientKeyEpochId,
    userId: input.userId,
    wrapManifestHash: kek.accessManifestHash,
  });
  kek.wraps = [
    substituteWrap as unknown as (typeof tamperedProjection.containerKeks)[number]["wraps"][number],
  ];

  return tamperedProjection;
}

export function tamperFirstProjectionEventSignature(
  projection: ContainerWriterProjectionResponse,
): ContainerWriterProjectionResponse {
  const tamperedProjection = structuredClone(projection);
  const signedEvent = tamperedProjection.path[0]?.event
    .event as unknown as AccessEvent;
  const signature = signedEvent.signature;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Expected signed container event fixture");
  }

  // Change one trailing character so signature verification fails while the
  // surrounding event shape stays intact. If it already ends in "A", use "B";
  // otherwise use "A" so the tampered value is guaranteed to differ.
  signedEvent.signature = `${signature.slice(0, -1)}${
    signature.endsWith("A") ? "B" : "A"
  }`;
  return tamperedProjection;
}
