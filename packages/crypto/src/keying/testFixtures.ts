import { expect } from "bun:test";
import { toFingerprint } from "../fingerprint";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import type {
  AccessManifest,
  AttachmentAccessEventBody,
  AttachmentBindAccessEventBody,
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerCreateAccessEventBody,
  ContainerDirectGrant,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  DocumentAccessEventBody,
  DocumentLinkSetManifestState,
  KeyingCanonicalJson,
  KeyingVerificationCode,
  KeyingVerificationResult,
  SignedTransparencyTreeHead,
  UnsignedAccessEvent,
  VerifiedAccessEvent,
  VerifiedAccessManifest,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedDocumentKekTargets,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
  WriteHeader,
} from "./index";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContainerKekRecipientTargetHash,
  computeContentRecordNonceDomainHash,
  computeKeyingDomainHash,
  computeTransparencyMerkleRoot,
  deriveBlobKekTargets,
  deriveContainerAccessManifest,
  deriveDocumentKekTargets,
  deriveDocumentLinkSetManifest,
  signAccessEvent,
  signTransparencyTreeHead,
  signWriteHeader,
  verifyAccessManifest,
  verifyAttachmentBindingEvent,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "./index";

export function expectVerificationError<T>(
  result: KeyingVerificationResult<T>,
  code: KeyingVerificationCode,
) {
  if (result.ok) {
    throw new Error("Expected verification to fail");
  }

  expect(result.error.code).toBe(code);
}

export async function fixtureHash(label: string): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.access-event-body", {
    fixture: label,
  });
}

export async function createSignedContainerEvent(input: {
  readonly body?: { readonly [key: string]: string };
  readonly overrides?: Partial<UnsignedAccessEvent>;
}) {
  const signing = generateSigningSeedAndKeyPair();
  const body = input.body ?? { action: "grant" };
  const previousManifestHash = await fixtureHash("previous-manifest");
  const dependencyA = await fixtureHash("dependency-a");
  const dependencyB = await fixtureHash("dependency-b");
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
    eventId: "event-1",
    eventType: "container.grant",
    objectKind: "container",
    objectId: "container-1",
    organizationId: "organization-1",
    previousManifestHash,
    dependencyManifestHashes: [dependencyB, dependencyA],
    bodyHash: await computeAccessEventBodyHash(body),
    signerUserId: "user-1",
    signerDeviceId: "device-1",
    signerKeyFingerprint: await toFingerprint(signing.signingPublicKey),
    signedAt: "2026-04-25T12:00:00.000Z",
    ...input.overrides,
  };

  return {
    body,
    event: await signAccessEvent(unsignedEvent, signing.signingPrivateKey),
    signingPublicKey: signing.signingPublicKey,
  };
}

export async function createVerifiedEvent(): Promise<VerifiedAccessEvent> {
  const fixture = await createSignedContainerEvent({});
  const result = await verifySignedAccessEvent({
    body: fixture.body,
    event: fixture.event,
    signerPublicKey: fixture.signingPublicKey,
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

export async function createManifest(event: VerifiedAccessEvent) {
  const keyTargetHash = await computeContainerKekRecipientTargetHash([
    {
      recipientKind: "group",
      recipientId: "group-1",
      recipientKeyEpochId: "group-key-epoch-1",
      recipientKeyFingerprint: await fixtureHash("group-key"),
    },
  ]);
  const manifest: AccessManifest = {
    version: 1,
    objectKind: "container",
    objectId: "container-1",
    organizationId: "organization-1",
    epoch: 2,
    previousManifestHash: event.event.previousManifestHash,
    eventHash: event.eventHash,
    structuralHash: await fixtureHash("structural"),
    grantRoot: await fixtureHash("grant-root"),
    referencedPrincipalHeads: [
      {
        principalType: "group",
        principalId: "group-1",
        version: 3,
        keyEpoch: 2,
        stateHash: await fixtureHash("group-state"),
        keyFingerprint: await fixtureHash("group-key"),
      },
    ],
    keyTargetHash,
  };

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
  };
}

export async function createVerifiedAccessManifestCheckpointFixture(input: {
  readonly epoch: number;
  readonly previousManifestHash: string | null;
  readonly structuralLabel?: string;
}): Promise<VerifiedAccessManifest> {
  const fixture = await createSignedContainerEvent({
    overrides: {
      previousManifestHash: input.previousManifestHash,
    },
  });
  const eventResult = await verifySignedAccessEvent({
    body: fixture.body,
    event: fixture.event,
    signerPublicKey: fixture.signingPublicKey,
  });

  if (!eventResult.ok) {
    throw eventResult.error;
  }

  const { manifest } = await createManifest(eventResult.value);
  const checkpointManifest: AccessManifest = {
    ...manifest,
    epoch: input.epoch,
    previousManifestHash: input.previousManifestHash,
    structuralHash: await fixtureHash(
      input.structuralLabel ?? `structural-${input.epoch}`,
    ),
  };
  const manifestHash = await computeAccessManifestHash(checkpointManifest);
  const verifiedManifest = await verifyAccessManifest({
    manifest: checkpointManifest,
    expectedManifestHash: manifestHash,
    event: eventResult.value,
    expectedPreviousManifestHash: input.previousManifestHash,
  });

  if (!verifiedManifest.ok) {
    throw verifiedManifest.error;
  }

  return verifiedManifest.value;
}

export async function signTransparencyTreeHeadFixture(input: {
  readonly leafHashes: readonly string[];
  readonly logId?: string;
  readonly signing?: ReturnType<typeof generateSigningSeedAndKeyPair>;
}): Promise<{
  readonly treeHead: SignedTransparencyTreeHead;
  readonly signingPublicKey: Uint8Array;
}> {
  const signing = input.signing ?? generateSigningSeedAndKeyPair();
  const treeHead = await signTransparencyTreeHead(
    {
      version: 1,
      logId: input.logId ?? "keying-transparency-log",
      treeSize: input.leafHashes.length,
      rootHash: await computeTransparencyMerkleRoot(input.leafHashes),
      signedAt: "2026-04-27T12:00:00.000Z",
      logKeyFingerprint: await toFingerprint(signing.signingPublicKey),
    },
    signing.signingPrivateKey,
  );

  return {
    treeHead,
    signingPublicKey: signing.signingPublicKey,
  };
}

export async function createVerifiedContainerAccessEvent(input: {
  readonly body: ContainerAccessEventBody;
  readonly dependencyManifestHashes?: readonly string[];
  readonly objectId: string;
  readonly organizationId: string;
  readonly previousManifestHash: string | null;
  readonly signer: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId: string;
}) {
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "container",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: input.previousManifestHash,
      dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signerUserId,
      signerDeviceId: "device-1",
      signerKeyFingerprint: await toFingerprint(input.signer.signingPublicKey),
      signedAt: "2026-04-25T12:00:00.000Z",
    },
    input.signer.signingPrivateKey,
  );
  const verifiedEvent = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingCanonicalJson,
    event,
    signerPublicKey: input.signer.signingPublicKey,
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

export async function createVerifiedDocumentAccessEvent(input: {
  readonly body: DocumentAccessEventBody;
  readonly dependencyManifestHashes?: readonly string[];
  readonly objectId: string;
  readonly organizationId: string;
  readonly previousManifestHash: string | null;
  readonly signer: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId: string;
}) {
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "document",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: input.previousManifestHash,
      dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signerUserId,
      signerDeviceId: "device-1",
      signerKeyFingerprint: await toFingerprint(input.signer.signingPublicKey),
      signedAt: "2026-04-25T12:00:00.000Z",
    },
    input.signer.signingPrivateKey,
  );
  const verifiedEvent = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingCanonicalJson,
    event,
    signerPublicKey: input.signer.signingPublicKey,
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

export async function createSignedAttachmentEvent(input: {
  readonly body: AttachmentAccessEventBody;
  readonly dependencyManifestHashes: readonly string[];
  readonly objectId: string;
  readonly organizationId: string;
  readonly signer: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId: string;
}) {
  return signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "blob",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: null,
      dependencyManifestHashes: [...input.dependencyManifestHashes],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signerUserId,
      signerDeviceId: "device-1",
      signerKeyFingerprint: await toFingerprint(input.signer.signingPublicKey),
      signedAt: "2026-04-25T12:00:00.000Z",
    },
    input.signer.signingPrivateKey,
  );
}

export async function createVerifiedAttachmentBinding(input: {
  readonly bindingId: string;
  readonly blobId: string;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly expectedBindingId?: string | null;
  readonly signer: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId: string;
  readonly slotId: string;
  readonly writePath: readonly VerifiedContainerAccessManifest[];
}) {
  const body: AttachmentBindAccessEventBody = {
    eventType: "attachment.bind",
    bindingId: input.bindingId,
    blobId: input.blobId,
    documentId: input.documentManifest.state.documentId,
    slotId: input.slotId,
    expectedBindingId: input.expectedBindingId ?? null,
    documentManifestHash: input.documentManifest.manifestHash,
  };
  const writeManifest = input.writePath.at(-1);
  if (!writeManifest) {
    throw new Error("Attachment binding fixture requires a write path");
  }
  const event = await createSignedAttachmentEvent({
    body,
    dependencyManifestHashes: [
      input.documentManifest.manifestHash,
      writeManifest.manifestHash,
    ],
    objectId: input.blobId,
    organizationId: input.documentManifest.state.organizationId,
    signer: input.signer,
    signerUserId: input.signerUserId,
  });
  const verifiedBinding = await verifyAttachmentBindingEvent({
    body: body as unknown as KeyingCanonicalJson,
    event,
    signerPublicKey: input.signer.signingPublicKey,
    documentManifest: input.documentManifest,
    authorizingContainerPaths: [input.writePath],
  });

  if (!verifiedBinding.ok) {
    throw verifiedBinding.error;
  }

  return verifiedBinding.value;
}

export async function createContainerManifestFixture(input: {
  readonly containerId: string;
  readonly containerKeyEpochId?: string | null;
  readonly directGrants: readonly ContainerDirectGrant[];
  readonly epoch?: number;
  readonly event?: VerifiedAccessEvent;
  readonly metadataDocumentId?: string;
  readonly organizationId?: string;
  readonly parentContainerId?: string | null;
  readonly parentManifestHash?: string | null;
  readonly previousManifestHash?: string | null;
  readonly referencedPrincipalHeads?: ContainerAccessManifestState["referencedPrincipalHeads"];
  readonly signer?: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId?: string;
}): Promise<VerifiedContainerAccessManifest> {
  const organizationId = input.organizationId ?? "organization-1";
  const signer = input.signer ?? generateSigningSeedAndKeyPair();
  const metadataDocumentId =
    input.metadataDocumentId ?? `${input.containerId}-metadata-document`;
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: input.parentContainerId ?? null,
    parentManifestHash: input.parentManifestHash ?? null,
    metadataDocumentId,
    containerKeyEpochId: input.containerKeyEpochId ?? null,
    directGrants: [...input.directGrants],
    referencedPrincipalHeads: input.referencedPrincipalHeads ?? [],
  };
  const event =
    input.event ??
    (await createVerifiedContainerAccessEvent({
      body,
      objectId: input.containerId,
      organizationId,
      previousManifestHash: input.previousManifestHash ?? null,
      signer,
      signerUserId: input.signerUserId ?? "fixture-signer",
    }));
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.containerId,
    organizationId,
    epoch: input.epoch ?? 1,
    previousManifestHash: input.previousManifestHash ?? null,
    eventHash: event.eventHash,
    parentContainerId: input.parentContainerId ?? null,
    parentManifestHash: input.parentManifestHash ?? null,
    metadataDocumentId,
    containerKeyEpochId: input.containerKeyEpochId ?? null,
    directGrants: [...input.directGrants],
    referencedPrincipalHeads: input.referencedPrincipalHeads ?? [],
  };
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    event,
    state,
  } as VerifiedContainerAccessManifest;
}

export function createPrincipalPolicyFixture(
  principalHead: ContainerAccessManifestState["referencedPrincipalHeads"][number],
): VerifiedPrincipalPolicy {
  return {
    principalType: principalHead.principalType,
    principalId: principalHead.principalId,
    version: principalHead.version,
    keyEpoch: principalHead.keyEpoch,
    stateHash: principalHead.stateHash,
    state: {
      keyFingerprint: principalHead.keyFingerprint,
    },
    projection: [],
    checkpoint: {
      principalType: principalHead.principalType,
      principalId: principalHead.principalId,
      version: principalHead.version,
      stateHash: principalHead.stateHash,
    },
  } as unknown as VerifiedPrincipalPolicy;
}

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

export async function createDocumentLinkSetManifestFixture(input: {
  readonly documentId: string;
  readonly event: VerifiedAccessEvent;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
  readonly previousManifestHash?: string | null;
  readonly epoch?: number;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId: input.documentId,
    organizationId: input.organizationId,
    epoch: input.epoch ?? 1,
    previousManifestHash: input.previousManifestHash ?? null,
    eventHash: input.event.eventHash,
    linkedContainerIds: [...input.linkedContainerIds].sort(),
  };
  const manifest = await deriveDocumentLinkSetManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    event: input.event,
    state,
  } as VerifiedDocumentLinkSetManifest;
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
        recipientKeyEpochId: ["user", userId, 1, recipientKeyFingerprint].join(
          ":",
        ),
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

export async function createWriteHeaderFixture(input: {
  readonly accessManifestHash: string;
  readonly contentRecordId?: string;
  readonly contentKeyEpoch?: number;
  readonly objectId: string;
  readonly objectKind?: "blob" | "document";
  readonly organizationId: string;
  readonly signing: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly targetHash: string;
  readonly writerUserId: string;
}): Promise<WriteHeader> {
  const contentKeyEpoch = input.contentKeyEpoch ?? 1;
  const contentRecordId =
    input.contentRecordId ?? "11111111-1111-4111-8111-111111111111";

  return signWriteHeader(
    {
      version: 1,
      organizationId: input.organizationId,
      objectKind: input.objectKind ?? "document",
      objectId: input.objectId,
      accessManifestHash: input.accessManifestHash,
      contentKeyEpoch,
      targetHash: input.targetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId: input.organizationId,
        objectKind: input.objectKind ?? "document",
        objectId: input.objectId,
        contentKeyEpoch,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
        contentRecordId,
      }),
      metadataHash: await fixtureHash(`${contentRecordId}:metadata`),
      ciphertextHash: await fixtureHash(`${contentRecordId}:ciphertext`),
      writerUserId: input.writerUserId,
      writerDeviceId: "device-1",
      writerKeyFingerprint: await toFingerprint(input.signing.signingPublicKey),
      signedAt: "2026-04-25T12:00:00.000Z",
    },
    input.signing.signingPrivateKey,
  );
}
