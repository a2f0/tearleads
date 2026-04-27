import { expect, test } from "bun:test";
import { toFingerprint } from "./fingerprint";
import type {
  AccessEventV2,
  AccessManifestV2,
  AttachmentAccessEventBodyV2,
  AttachmentBindAccessEventBodyV2,
  AttachmentDetachAccessEventBodyV2,
  ContainerAccessEventBodyV2,
  ContainerAccessManifestStateV2,
  ContainerCreateAccessEventBodyV2,
  ContainerDirectGrantV2,
  ContainerKekTargetV2,
  ContainerKeyEpochV2,
  ContainerKeyWrapV2,
  ContainerUserRecipientKeyV2,
  DocumentAccessEventBodyV2,
  DocumentLinkSetManifestStateV2,
  KeyingV2CanonicalJson,
  KeyingV2VerificationCode,
  KeyingV2VerificationResult,
  UnsignedAccessEventV2,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
} from "./keyingV2";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeBlobContentKeyTargetHash,
  computeContainerKekRecipientTargetHash,
  computeDocumentContentKeyTargetHash,
  computeKeyingV2DomainHash,
  computeWriteHeaderHash,
  deriveBlobKekTargets,
  deriveContainerAccessManifest,
  deriveDocumentKekTargets,
  deriveDocumentLinkSetManifest,
  derivePrincipalRecipientKeyEpochId,
  serializeKeyingV2CanonicalJson,
  signAccessEvent,
  signWriteHeader,
  verifyAccessManifest,
  verifyAttachmentBindingEvent,
  verifyAttachmentDetachEvent,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifyContainerParentEdge,
  verifyDocumentLinkSetManifest,
  verifySignedAccessEvent,
  verifyWriteHeader,
} from "./keyingV2";
import { generateSigningSeedAndKeyPair } from "./signing/generateKeyPair";

function expectVerificationError<T>(
  result: KeyingV2VerificationResult<T>,
  code: KeyingV2VerificationCode,
) {
  if (result.ok) {
    throw new Error("Expected verification to fail");
  }

  expect(result.error.code).toBe(code);
}

async function fixtureHash(label: string): Promise<string> {
  return computeKeyingV2DomainHash("tearleads.keying-v2.access-event-body.v1", {
    fixture: label,
  });
}

async function createSignedContainerEvent(input: {
  readonly body?: { readonly [key: string]: string };
  readonly overrides?: Partial<UnsignedAccessEventV2>;
}) {
  const signing = generateSigningSeedAndKeyPair();
  const body = input.body ?? { action: "grant" };
  const previousManifestHash = await fixtureHash("previous-manifest");
  const dependencyA = await fixtureHash("dependency-a");
  const dependencyB = await fixtureHash("dependency-b");
  const unsignedEvent: UnsignedAccessEventV2 = {
    version: 2,
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

async function createVerifiedEvent(): Promise<VerifiedAccessEvent> {
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

async function createManifest(event: VerifiedAccessEvent) {
  const keyTargetHash = await computeContainerKekRecipientTargetHash([
    {
      recipientKind: "group",
      recipientId: "group-1",
      recipientKeyEpochId: "group-key-epoch-1",
      recipientKeyFingerprint: await fixtureHash("group-key"),
    },
  ]);
  const manifest: AccessManifestV2 = {
    version: 2,
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

async function createVerifiedContainerAccessEvent(input: {
  readonly body: ContainerAccessEventBodyV2;
  readonly dependencyManifestHashes?: readonly string[];
  readonly objectId: string;
  readonly organizationId: string;
  readonly previousManifestHash: string | null;
  readonly signer: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId: string;
}) {
  const event = await signAccessEvent(
    {
      version: 2,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "container",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: input.previousManifestHash,
      dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingV2CanonicalJson,
      ),
      signerUserId: input.signerUserId,
      signerDeviceId: "device-1",
      signerKeyFingerprint: await toFingerprint(input.signer.signingPublicKey),
      signedAt: "2026-04-25T12:00:00.000Z",
    },
    input.signer.signingPrivateKey,
  );
  const verifiedEvent = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingV2CanonicalJson,
    event,
    signerPublicKey: input.signer.signingPublicKey,
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

async function createVerifiedDocumentAccessEvent(input: {
  readonly body: DocumentAccessEventBodyV2;
  readonly dependencyManifestHashes?: readonly string[];
  readonly objectId: string;
  readonly organizationId: string;
  readonly previousManifestHash: string | null;
  readonly signer: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId: string;
}) {
  const event = await signAccessEvent(
    {
      version: 2,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "document",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: input.previousManifestHash,
      dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingV2CanonicalJson,
      ),
      signerUserId: input.signerUserId,
      signerDeviceId: "device-1",
      signerKeyFingerprint: await toFingerprint(input.signer.signingPublicKey),
      signedAt: "2026-04-25T12:00:00.000Z",
    },
    input.signer.signingPrivateKey,
  );
  const verifiedEvent = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingV2CanonicalJson,
    event,
    signerPublicKey: input.signer.signingPublicKey,
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

async function createSignedAttachmentEvent(input: {
  readonly body: AttachmentAccessEventBodyV2;
  readonly dependencyManifestHashes: readonly string[];
  readonly objectId: string;
  readonly organizationId: string;
  readonly signer: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId: string;
}) {
  return signAccessEvent(
    {
      version: 2,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "blob",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: null,
      dependencyManifestHashes: [...input.dependencyManifestHashes],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingV2CanonicalJson,
      ),
      signerUserId: input.signerUserId,
      signerDeviceId: "device-1",
      signerKeyFingerprint: await toFingerprint(input.signer.signingPublicKey),
      signedAt: "2026-04-25T12:00:00.000Z",
    },
    input.signer.signingPrivateKey,
  );
}

async function createVerifiedAttachmentBinding(input: {
  readonly bindingId: string;
  readonly blobId: string;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly expectedBindingId?: string | null;
  readonly signer: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId: string;
  readonly slotId: string;
  readonly writePath: readonly VerifiedContainerAccessManifest[];
}) {
  const body: AttachmentBindAccessEventBodyV2 = {
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
    body: body as unknown as KeyingV2CanonicalJson,
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

async function createContainerManifestFixture(input: {
  readonly containerId: string;
  readonly containerKeyEpochId?: string | null;
  readonly directGrants: readonly ContainerDirectGrantV2[];
  readonly epoch?: number;
  readonly event?: VerifiedAccessEvent;
  readonly organizationId?: string;
  readonly parentContainerId?: string | null;
  readonly parentManifestHash?: string | null;
  readonly previousManifestHash?: string | null;
  readonly referencedPrincipalHeads?: ContainerAccessManifestStateV2["referencedPrincipalHeads"];
  readonly signer?: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId?: string;
}): Promise<VerifiedContainerAccessManifest> {
  const organizationId = input.organizationId ?? "organization-1";
  const signer = input.signer ?? generateSigningSeedAndKeyPair();
  const body: ContainerCreateAccessEventBodyV2 = {
    eventType: "container.create",
    parentContainerId: input.parentContainerId ?? null,
    parentManifestHash: input.parentManifestHash ?? null,
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
  const state: ContainerAccessManifestStateV2 = {
    version: 2,
    containerId: input.containerId,
    organizationId,
    epoch: input.epoch ?? 1,
    previousManifestHash: input.previousManifestHash ?? null,
    eventHash: event.eventHash,
    parentContainerId: input.parentContainerId ?? null,
    parentManifestHash: input.parentManifestHash ?? null,
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

function createPrincipalPolicyFixture(
  principalHead: ContainerAccessManifestStateV2["referencedPrincipalHeads"][number],
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

async function createContainerKeyEpochFixture(input: {
  readonly createdByManifest?: VerifiedContainerAccessManifest;
  readonly keyEpoch?: number;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly parentContainerKeyEpochId?: string | null;
}): Promise<ContainerKeyEpochV2> {
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

async function createContainerKeyWrap(input: {
  readonly containerKeyEpochId: string;
  readonly recipientKind: ContainerKeyWrapV2["recipientKind"];
  readonly recipientId: string;
  readonly recipientKeyEpochId: string;
  readonly recipientKeyFingerprint: string;
  readonly wrapManifestHash: string;
}): Promise<ContainerKeyWrapV2> {
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

async function createDocumentLinkSetManifestFixture(input: {
  readonly documentId: string;
  readonly event: VerifiedAccessEvent;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
  readonly previousManifestHash?: string | null;
  readonly epoch?: number;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const state: DocumentLinkSetManifestStateV2 = {
    version: 2,
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

async function createVerifiedContainerKekStateFixture(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly recipientUserId: string;
}): Promise<VerifiedContainerKekState> {
  const keyEpoch = await createContainerKeyEpochFixture({
    manifest: input.manifest,
  });
  const recipientKeyFingerprint = await fixtureHash(
    `${input.manifest.state.containerId}:recipient-key`,
  );
  const recipientKeyEpochId = [
    "user",
    input.recipientUserId,
    1,
    recipientKeyFingerprint,
  ].join(":");
  const result = await verifyContainerKekState({
    containerManifest: input.manifest,
    keyEpoch,
    userRecipientKeys: [
      {
        userId: input.recipientUserId,
        recipientKeyEpochId,
        recipientKeyFingerprint,
      },
    ],
    wraps: [
      await createContainerKeyWrap({
        containerKeyEpochId: keyEpoch.id,
        recipientKind: "user",
        recipientId: input.recipientUserId,
        recipientKeyEpochId,
        recipientKeyFingerprint,
        wrapManifestHash: input.manifest.manifestHash,
      }),
    ],
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

test("keying v2 canonical JSON sorts object keys deterministically", () => {
  const umlautA = "\u00e4";

  expect(
    serializeKeyingV2CanonicalJson({
      z: "last",
      a: { y: "why", b: "bee" },
    }),
  ).toBe(
    serializeKeyingV2CanonicalJson({
      a: { b: "bee", y: "why" },
      z: "last",
    }),
  );

  expect(
    serializeKeyingV2CanonicalJson({
      [umlautA]: "umlaut",
      z: "zed",
      a: "aye",
    }),
  ).toBe(`{"a":"aye","z":"zed","${umlautA}":"umlaut"}`);
});

test("keying v2 target hashes sort arrays where ordering is a set", async () => {
  const firstTarget: ContainerKekTargetV2 = {
    containerId: "container-a",
    containerManifestHash: await fixtureHash("container-a-manifest"),
    containerKeyEpochId: "container-a-key-epoch",
    containerKeyEpoch: 1,
  };
  const secondTarget: ContainerKekTargetV2 = {
    containerId: "container-b",
    containerManifestHash: await fixtureHash("container-b-manifest"),
    containerKeyEpochId: "container-b-key-epoch",
    containerKeyEpoch: 1,
  };

  await expect(
    computeDocumentContentKeyTargetHash([firstTarget, secondTarget]),
  ).resolves.toBe(
    await computeDocumentContentKeyTargetHash([secondTarget, firstTarget]),
  );
});

test("keying v2 target hashes reject duplicate canonical entries", async () => {
  const target: ContainerKekTargetV2 = {
    containerId: "container-a",
    containerManifestHash: await fixtureHash("container-a-manifest"),
    containerKeyEpochId: "container-a-key-epoch",
    containerKeyEpoch: 1,
  };

  await expect(
    computeDocumentContentKeyTargetHash([target, target]),
  ).rejects.toThrow("document content-key targets contains a duplicate");
});

test("verifySignedAccessEvent accepts a valid signed event and normalizes dependency order", async () => {
  const fixture = await createSignedContainerEvent({});
  const dependencyManifestHashes = fixture.event.dependencyManifestHashes;
  const result = await verifySignedAccessEvent({
    body: fixture.body,
    event: fixture.event,
    signerPublicKey: fixture.signingPublicKey,
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.event.dependencyManifestHashes).toEqual(
      [...dependencyManifestHashes].sort(),
    );
    expect(result.value.eventHash).toHaveLength(64);
  }
});

test("verifySignedAccessEvent rejects unexpected and missing fields", async () => {
  const fixture = await createSignedContainerEvent({});
  const extraFieldResult = await verifySignedAccessEvent({
    body: fixture.body,
    event: { ...fixture.event, extra: "not allowed" } as AccessEventV2,
    signerPublicKey: fixture.signingPublicKey,
  });
  expectVerificationError(extraFieldResult, "invalid_shape");

  const missingObjectId = { ...fixture.event } as Partial<AccessEventV2>;
  delete missingObjectId.objectId;
  const missingFieldResult = await verifySignedAccessEvent({
    body: fixture.body,
    event: missingObjectId as AccessEventV2,
    signerPublicKey: fixture.signingPublicKey,
  });
  expectVerificationError(missingFieldResult, "invalid_shape");
});

test("verifySignedAccessEvent rejects tampered bodies and wrong domain hashes", async () => {
  const fixture = await createSignedContainerEvent({});
  const tamperedBodyResult = await verifySignedAccessEvent({
    body: { action: "revoke" },
    event: fixture.event,
    signerPublicKey: fixture.signingPublicKey,
  });
  expectVerificationError(tamperedBodyResult, "hash_mismatch");

  const wrongDomainBodyHash = await computeKeyingV2DomainHash(
    "tearleads.keying-v2.document-content-key-targets.v1",
    [{ action: "grant" }],
  );
  const wrongDomainFixture = await createSignedContainerEvent({
    overrides: {
      bodyHash: wrongDomainBodyHash,
    },
  });
  const wrongDomainResult = await verifySignedAccessEvent({
    body: wrongDomainFixture.body,
    event: wrongDomainFixture.event,
    signerPublicKey: wrongDomainFixture.signingPublicKey,
  });
  expectVerificationError(wrongDomainResult, "hash_mismatch");
});

test("verifySignedAccessEvent rejects bad signatures and wrong signer fingerprints", async () => {
  const fixture = await createSignedContainerEvent({});
  const badSignatureResult = await verifySignedAccessEvent({
    body: fixture.body,
    event: {
      ...fixture.event,
      eventId: "tampered-event-id",
    },
    signerPublicKey: fixture.signingPublicKey,
  });
  expectVerificationError(badSignatureResult, "signature_mismatch");

  const otherSigning = generateSigningSeedAndKeyPair();
  const wrongFingerprintFixture = await createSignedContainerEvent({
    overrides: {
      signerKeyFingerprint: await toFingerprint(otherSigning.signingPublicKey),
    },
  });
  const wrongFingerprintResult = await verifySignedAccessEvent({
    body: wrongFingerprintFixture.body,
    event: wrongFingerprintFixture.event,
    signerPublicKey: wrongFingerprintFixture.signingPublicKey,
  });
  expectVerificationError(wrongFingerprintResult, "signer_mismatch");
});

test("verifySignedAccessEvent rejects event/object kind domain mismatches", async () => {
  const fixture = await createSignedContainerEvent({});

  const result = await verifySignedAccessEvent({
    body: fixture.body,
    event: {
      ...fixture.event,
      objectKind: "document",
    },
    signerPublicKey: fixture.signingPublicKey,
  });

  expectVerificationError(result, "object_mismatch");
});

test("verifyAccessManifest accepts a valid manifest", async () => {
  const event = await createVerifiedEvent();
  const { manifest, manifestHash } = await createManifest(event);
  const result = await verifyAccessManifest({
    manifest,
    expectedManifestHash: manifestHash,
    event,
    expectedObject: {
      objectKind: "container",
      objectId: "container-1",
    },
    expectedPreviousManifestHash: event.event.previousManifestHash,
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.manifestHash).toBe(manifestHash);
  }
});

test("verifyAccessManifest rejects tampered manifest hashes and stale predecessors", async () => {
  const event = await createVerifiedEvent();
  const { manifest } = await createManifest(event);
  const wrongHashResult = await verifyAccessManifest({
    manifest,
    expectedManifestHash: await fixtureHash("wrong-manifest-hash"),
    event,
  });
  expectVerificationError(wrongHashResult, "hash_mismatch");

  const stalePredecessorResult = await verifyAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    expectedPreviousManifestHash: await fixtureHash("unexpected-previous"),
  });
  expectVerificationError(stalePredecessorResult, "stale_predecessor");
});

test("verifyAccessManifest rejects wrong expected object ids", async () => {
  const event = await createVerifiedEvent();
  const { manifest, manifestHash } = await createManifest(event);
  const result = await verifyAccessManifest({
    manifest,
    expectedManifestHash: manifestHash,
    event,
    expectedObject: {
      objectKind: "container",
      objectId: "other-container",
    },
  });

  expectVerificationError(result, "object_mismatch");
});

test("verifyAccessManifest rejects duplicate referenced principal heads", async () => {
  const event = await createVerifiedEvent();
  const { manifest } = await createManifest(event);
  const referencedPrincipalHead = manifest.referencedPrincipalHeads.at(0);

  if (!referencedPrincipalHead) {
    throw new Error("expected manifest fixture to include a principal head");
  }

  await expect(
    computeAccessManifestHash({
      ...manifest,
      referencedPrincipalHeads: [
        referencedPrincipalHead,
        referencedPrincipalHead,
      ],
    }),
  ).rejects.toThrow(
    "access manifest referencedPrincipalHeads contains a duplicate",
  );
});

test("verifyContainerAccessManifest accepts a signed child create under a writable parent", async () => {
  const adminUserId = "admin-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const parent = await createContainerManifestFixture({
    containerId: "parent-container",
    containerKeyEpochId: "parent-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const createBody: ContainerCreateAccessEventBodyV2 = {
    eventType: "container.create",
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    referencedPrincipalHeads: [],
  };
  const event = await createVerifiedContainerAccessEvent({
    body: createBody,
    objectId: "child-container",
    organizationId: parent.state.organizationId,
    previousManifestHash: null,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const state: ContainerAccessManifestStateV2 = {
    version: 2,
    containerId: "child-container",
    organizationId: parent.state.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: createBody.directGrants,
    referencedPrincipalHeads: [],
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: manifestHash,
    event,
    parentContainerPath: [parent],
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.state.parentManifestHash).toBe(parent.manifestHash);
  }
});

test("verifyContainerAccessManifest rejects a forged API-only grant row", async () => {
  const adminUserId = "admin-user";
  const aliceUserId = "alice-user";
  const bobUserId = "bob-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const previous = await createContainerManifestFixture({
    containerId: "container-1",
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const body: ContainerAccessEventBodyV2 = {
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant: {
      subjectType: "user",
      subjectId: aliceUserId,
      accessLevel: "read",
    },
    referencedPrincipalHead: null,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const forgedState: ContainerAccessManifestStateV2 = {
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash: event.eventHash,
    directGrants: [
      ...previous.state.directGrants,
      body.grant,
      {
        subjectType: "user",
        subjectId: bobUserId,
        accessLevel: "read",
      },
    ],
  };
  const forgedManifest = await deriveContainerAccessManifest(forgedState);

  const result = await verifyContainerAccessManifest({
    manifest: forgedManifest,
    expectedManifestHash: await computeAccessManifestHash(forgedManifest),
    event,
    previousManifest: previous,
    previousContainerPath: [previous],
  });

  expectVerificationError(result, "hash_mismatch");
});

test("verifyContainerAccessManifest rejects container grants signed by non-admins", async () => {
  const adminUserId = "admin-user";
  const writerUserId = "writer-user";
  const aliceUserId = "alice-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const writerSigning = generateSigningSeedAndKeyPair();
  const previous = await createContainerManifestFixture({
    containerId: "container-1",
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const body: ContainerAccessEventBodyV2 = {
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant: {
      subjectType: "user",
      subjectId: aliceUserId,
      accessLevel: "read",
    },
    referencedPrincipalHead: null,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash: event.eventHash,
    directGrants: [...previous.state.directGrants, body.grant],
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    previousManifest: previous,
    previousContainerPath: [previous],
  });

  expectVerificationError(result, "unauthorized");
});

test("verifyContainerAccessManifest rejects child create signed without parent write access", async () => {
  const readerUserId = "reader-user";
  const readerSigning = generateSigningSeedAndKeyPair();
  const parent = await createContainerManifestFixture({
    containerId: "parent-container",
    containerKeyEpochId: "parent-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: readerUserId,
        accessLevel: "read",
      },
    ],
    signer: readerSigning,
    signerUserId: readerUserId,
  });
  const body: ContainerCreateAccessEventBodyV2 = {
    eventType: "container.create",
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: readerUserId,
        accessLevel: "admin",
      },
    ],
    referencedPrincipalHeads: [],
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: "child-container",
    organizationId: parent.state.organizationId,
    previousManifestHash: null,
    signer: readerSigning,
    signerUserId: readerUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    version: 2,
    containerId: "child-container",
    organizationId: parent.state.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: body.directGrants,
    referencedPrincipalHeads: [],
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    parentContainerPath: [parent],
  });

  expectVerificationError(result, "unauthorized");
});

test("verifyContainerAccessManifest rejects moving a container under its descendant", async () => {
  const adminUserId = "admin-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const root = await createContainerManifestFixture({
    containerId: "root-container",
    containerKeyEpochId: "root-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const child = await createContainerManifestFixture({
    containerId: "child-container",
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [],
    parentContainerId: root.state.containerId,
    parentManifestHash: root.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const grandchild = await createContainerManifestFixture({
    containerId: "grandchild-container",
    containerKeyEpochId: "grandchild-key-epoch-1",
    directGrants: [],
    parentContainerId: child.state.containerId,
    parentManifestHash: child.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const body: ContainerAccessEventBodyV2 = {
    eventType: "container.move",
    parentContainerId: grandchild.state.containerId,
    parentManifestHash: grandchild.manifestHash,
    containerKeyEpochId: "child-key-epoch-2",
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: child.state.containerId,
    organizationId: child.state.organizationId,
    previousManifestHash: child.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    ...child.state,
    epoch: child.state.epoch + 1,
    previousManifestHash: child.manifestHash,
    eventHash: event.eventHash,
    parentContainerId: grandchild.state.containerId,
    parentManifestHash: grandchild.manifestHash,
    containerKeyEpochId: "child-key-epoch-2",
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    previousManifest: child,
    previousContainerPath: [root, child],
    destinationParentContainerPath: [root, child, grandchild],
  });

  expectVerificationError(result, "object_mismatch");
});

test("verifyContainerAccessManifest rejects parent manifest hash mismatches", async () => {
  const adminUserId = "admin-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const parent = await createContainerManifestFixture({
    containerId: "parent-container",
    containerKeyEpochId: "parent-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const wrongParentManifestHash = await fixtureHash("wrong-parent-manifest");
  const body: ContainerCreateAccessEventBodyV2 = {
    eventType: "container.create",
    parentContainerId: parent.state.containerId,
    parentManifestHash: wrongParentManifestHash,
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: "child-container",
    organizationId: parent.state.organizationId,
    previousManifestHash: null,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    version: 2,
    containerId: "child-container",
    organizationId: parent.state.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    parentContainerId: parent.state.containerId,
    parentManifestHash: wrongParentManifestHash,
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [],
    referencedPrincipalHeads: [],
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    parentContainerPath: [parent],
  });

  expectVerificationError(result, "missing_dependency");
});

test("parent sharing does not require descendant container manifest rewrites", async () => {
  const adminUserId = "admin-user";
  const aliceUserId = "alice-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const parent = await createContainerManifestFixture({
    containerId: "parent-container",
    containerKeyEpochId: "parent-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const child = await createContainerManifestFixture({
    containerId: "child-container",
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [],
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const childManifestHashBeforeParentShare = child.manifestHash;
  const body: ContainerAccessEventBodyV2 = {
    eventType: "container.grant",
    containerKeyEpochId: parent.state.containerKeyEpochId,
    grant: {
      subjectType: "user",
      subjectId: aliceUserId,
      accessLevel: "read",
    },
    referencedPrincipalHead: null,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: parent.state.containerId,
    organizationId: parent.state.organizationId,
    previousManifestHash: parent.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const parentAfterShareManifest = await deriveContainerAccessManifest({
    ...parent.state,
    epoch: parent.state.epoch + 1,
    previousManifestHash: parent.manifestHash,
    eventHash: event.eventHash,
    directGrants: [...parent.state.directGrants, body.grant],
  });
  const parentAfterShare = await verifyContainerAccessManifest({
    manifest: parentAfterShareManifest,
    expectedManifestHash: await computeAccessManifestHash(
      parentAfterShareManifest,
    ),
    event,
    previousManifest: parent,
    previousContainerPath: [parent],
  });

  expect(parentAfterShare.ok).toBe(true);
  if (!parentAfterShare.ok) {
    throw parentAfterShare.error;
  }

  expect(child.manifestHash).toBe(childManifestHashBeforeParentShare);
  expect(
    verifyContainerParentEdge({
      child,
      parentHistory: [parentAfterShare.value, parent],
    }).ok,
  ).toBe(true);
});

test("verifyDocumentLinkSetManifest advances signed link and unlink heads", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const firstContainer = await createContainerManifestFixture({
    containerId: "container-a",
    containerKeyEpochId: "container-a-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const secondContainer = await createContainerManifestFixture({
    containerId: "container-b",
    containerKeyEpochId: "container-b-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const documentId = "document-1";
  const initialBody: DocumentAccessEventBodyV2 = {
    eventType: "document.link",
    containerId: firstContainer.state.containerId,
    containerManifestHash: firstContainer.manifestHash,
  };
  const initialEvent = await createVerifiedDocumentAccessEvent({
    body: initialBody,
    dependencyManifestHashes: [firstContainer.manifestHash],
    objectId: documentId,
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const initialManifest = await createDocumentLinkSetManifestFixture({
    documentId,
    event: initialEvent,
    linkedContainerIds: [firstContainer.state.containerId],
    organizationId: firstContainer.state.organizationId,
  });
  const initialResult = await verifyDocumentLinkSetManifest({
    manifest: initialManifest.manifest,
    expectedManifestHash: initialManifest.manifestHash,
    event: initialEvent,
    targetContainerPath: [firstContainer],
  });

  expect(initialResult.ok).toBe(true);
  if (!initialResult.ok) {
    throw initialResult.error;
  }

  const linkBody: DocumentAccessEventBodyV2 = {
    eventType: "document.link",
    containerId: secondContainer.state.containerId,
    containerManifestHash: secondContainer.manifestHash,
  };
  const linkEvent = await createVerifiedDocumentAccessEvent({
    body: linkBody,
    dependencyManifestHashes: [
      firstContainer.manifestHash,
      secondContainer.manifestHash,
    ],
    objectId: documentId,
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: initialResult.value.manifestHash,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const linkedManifest = await createDocumentLinkSetManifestFixture({
    documentId,
    event: linkEvent,
    linkedContainerIds: [
      firstContainer.state.containerId,
      secondContainer.state.containerId,
    ],
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: initialResult.value.manifestHash,
    epoch: 2,
  });
  const linkResult = await verifyDocumentLinkSetManifest({
    manifest: linkedManifest.manifest,
    expectedManifestHash: linkedManifest.manifestHash,
    event: linkEvent,
    previousManifest: initialResult.value,
    authorizingContainerPaths: [[firstContainer]],
    targetContainerPath: [secondContainer],
  });

  expect(linkResult.ok).toBe(true);
  if (!linkResult.ok) {
    throw linkResult.error;
  }
  expect(linkResult.value.state.linkedContainerIds).toEqual([
    firstContainer.state.containerId,
    secondContainer.state.containerId,
  ]);

  const unlinkBody: DocumentAccessEventBodyV2 = {
    eventType: "document.unlink",
    containerId: secondContainer.state.containerId,
    containerManifestHash: secondContainer.manifestHash,
  };
  const unlinkEvent = await createVerifiedDocumentAccessEvent({
    body: unlinkBody,
    dependencyManifestHashes: [
      firstContainer.manifestHash,
      secondContainer.manifestHash,
    ],
    objectId: documentId,
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: linkResult.value.manifestHash,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const unlinkedManifest = await createDocumentLinkSetManifestFixture({
    documentId,
    event: unlinkEvent,
    linkedContainerIds: [firstContainer.state.containerId],
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: linkResult.value.manifestHash,
    epoch: 3,
  });
  const unlinkResult = await verifyDocumentLinkSetManifest({
    manifest: unlinkedManifest.manifest,
    expectedManifestHash: unlinkedManifest.manifestHash,
    event: unlinkEvent,
    previousManifest: linkResult.value,
    authorizingContainerPaths: [[firstContainer]],
    targetContainerPath: [secondContainer],
  });

  expect(unlinkResult.ok).toBe(true);
  if (!unlinkResult.ok) {
    throw unlinkResult.error;
  }
  expect(unlinkResult.value.state.linkedContainerIds).toEqual([
    firstContainer.state.containerId,
  ]);
});

test("verifyDocumentLinkSetManifest rejects forged linked containers", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const firstContainer = await createContainerManifestFixture({
    containerId: "container-a",
    containerKeyEpochId: "container-a-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const secondContainer = await createContainerManifestFixture({
    containerId: "container-b",
    containerKeyEpochId: "container-b-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const initialBody: DocumentAccessEventBodyV2 = {
    eventType: "document.link",
    containerId: firstContainer.state.containerId,
    containerManifestHash: firstContainer.manifestHash,
  };
  const initialEvent = await createVerifiedDocumentAccessEvent({
    body: initialBody,
    dependencyManifestHashes: [firstContainer.manifestHash],
    objectId: "document-1",
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const forgedManifest = await createDocumentLinkSetManifestFixture({
    documentId: "document-1",
    event: initialEvent,
    linkedContainerIds: [
      firstContainer.state.containerId,
      secondContainer.state.containerId,
    ],
    organizationId: firstContainer.state.organizationId,
  });

  const result = await verifyDocumentLinkSetManifest({
    manifest: forgedManifest.manifest,
    expectedManifestHash: forgedManifest.manifestHash,
    event: initialEvent,
    targetContainerPath: [firstContainer],
  });

  expectVerificationError(result, "hash_mismatch");
});

test("deriveDocumentKekTargets resolves every linked container KEK target", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const firstContainer = await createContainerManifestFixture({
    containerId: "container-a",
    containerKeyEpochId: "container-a-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const secondContainer = await createContainerManifestFixture({
    containerId: "container-b",
    containerKeyEpochId: "container-b-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const body: DocumentAccessEventBodyV2 = {
    eventType: "document.link",
    containerId: firstContainer.state.containerId,
    containerManifestHash: firstContainer.manifestHash,
  };
  const event = await createVerifiedDocumentAccessEvent({
    body,
    dependencyManifestHashes: [firstContainer.manifestHash],
    objectId: "document-1",
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const documentManifest = await createDocumentLinkSetManifestFixture({
    documentId: "document-1",
    event,
    linkedContainerIds: [
      secondContainer.state.containerId,
      firstContainer.state.containerId,
    ],
    organizationId: firstContainer.state.organizationId,
  });
  const firstKekState = await createVerifiedContainerKekStateFixture({
    manifest: firstContainer,
    recipientUserId: writerUserId,
  });
  const secondKekState = await createVerifiedContainerKekStateFixture({
    manifest: secondContainer,
    recipientUserId: writerUserId,
  });

  const result = await deriveDocumentKekTargets({
    documentManifest,
    linkedContainerManifests: [secondContainer, firstContainer],
    containerKekStates: [secondKekState, firstKekState],
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw result.error;
  }
  expect(result.value.targets).toEqual([
    {
      containerId: firstContainer.state.containerId,
      containerManifestHash: firstContainer.manifestHash,
      containerKeyEpochId: firstKekState.containerKeyEpochId,
      containerKeyEpoch: firstKekState.containerKeyEpoch,
    },
    {
      containerId: secondContainer.state.containerId,
      containerManifestHash: secondContainer.manifestHash,
      containerKeyEpochId: secondKekState.containerKeyEpochId,
      containerKeyEpoch: secondKekState.containerKeyEpoch,
    },
  ]);
  expect(result.value.documentKeyTargetHash).toBe(
    await computeDocumentContentKeyTargetHash(result.value.targets),
  );

  const missingTargetResult = await deriveDocumentKekTargets({
    documentManifest,
    linkedContainerManifests: [firstContainer],
    containerKekStates: [firstKekState],
  });
  expectVerificationError(missingTargetResult, "missing_dependency");

  const staleKekResult = await deriveDocumentKekTargets({
    documentManifest,
    linkedContainerManifests: [firstContainer, secondContainer],
    containerKekStates: [
      firstKekState,
      {
        ...secondKekState,
        accessManifestHash: await fixtureHash("stale-container-manifest"),
      } as VerifiedContainerKekState,
    ],
  });
  expectVerificationError(staleKekResult, "stale_predecessor");
});

test("attachment binding events prove signed document write authority", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const container = await createContainerManifestFixture({
    containerId: "attachment-container",
    containerKeyEpochId: "attachment-container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const documentEvent = await createVerifiedDocumentAccessEvent({
    body: {
      eventType: "document.link",
      containerId: container.state.containerId,
      containerManifestHash: container.manifestHash,
    },
    dependencyManifestHashes: [container.manifestHash],
    objectId: "attachment-document",
    organizationId: container.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const documentManifest = await createDocumentLinkSetManifestFixture({
    documentId: "attachment-document",
    event: documentEvent,
    linkedContainerIds: [container.state.containerId],
    organizationId: container.state.organizationId,
  });
  const bindBody: AttachmentBindAccessEventBodyV2 = {
    eventType: "attachment.bind",
    bindingId: "binding-1",
    blobId: "blob-1",
    documentId: documentManifest.state.documentId,
    slotId: "slot-1",
    expectedBindingId: null,
    documentManifestHash: documentManifest.manifestHash,
  };
  const bindEvent = await createSignedAttachmentEvent({
    body: bindBody,
    dependencyManifestHashes: [
      documentManifest.manifestHash,
      container.manifestHash,
    ],
    objectId: bindBody.blobId,
    organizationId: documentManifest.state.organizationId,
    signer: writerSigning,
    signerUserId: writerUserId,
  });

  const bindResult = await verifyAttachmentBindingEvent({
    body: bindBody as unknown as KeyingV2CanonicalJson,
    event: bindEvent,
    signerPublicKey: writerSigning.signingPublicKey,
    documentManifest,
    authorizingContainerPaths: [[container]],
  });
  expect(bindResult.ok).toBe(true);
  if (!bindResult.ok) {
    throw bindResult.error;
  }
  expect(bindResult.value).toMatchObject({
    bindingId: "binding-1",
    blobId: "blob-1",
    documentId: "attachment-document",
    documentManifestHash: documentManifest.manifestHash,
  });

  const missingAuthorityResult = await verifyAttachmentBindingEvent({
    body: bindBody as unknown as KeyingV2CanonicalJson,
    event: bindEvent,
    signerPublicKey: writerSigning.signingPublicKey,
    documentManifest,
    authorizingContainerPaths: [],
  });
  expectVerificationError(missingAuthorityResult, "unauthorized");

  const detachBody: AttachmentDetachAccessEventBodyV2 = {
    eventType: "attachment.detach",
    bindingId: bindBody.bindingId,
    blobId: bindBody.blobId,
    documentId: bindBody.documentId,
    slotId: bindBody.slotId,
    documentManifestHash: documentManifest.manifestHash,
  };
  const detachEvent = await createSignedAttachmentEvent({
    body: detachBody,
    dependencyManifestHashes: [
      documentManifest.manifestHash,
      container.manifestHash,
    ],
    objectId: detachBody.blobId,
    organizationId: documentManifest.state.organizationId,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const detachResult = await verifyAttachmentDetachEvent({
    body: detachBody as unknown as KeyingV2CanonicalJson,
    event: detachEvent,
    signerPublicKey: writerSigning.signingPublicKey,
    documentManifest,
    authorizingContainerPaths: [[container]],
  });

  expect(detachResult.ok).toBe(true);
});

test("deriveBlobKekTargets resolves the union of every active attachment binding", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const firstContainer = await createContainerManifestFixture({
    containerId: "blob-container-a",
    containerKeyEpochId: "blob-container-a-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const secondContainer = await createContainerManifestFixture({
    containerId: "blob-container-b",
    containerKeyEpochId: "blob-container-b-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const firstDocumentEvent = await createVerifiedDocumentAccessEvent({
    body: {
      eventType: "document.link",
      containerId: firstContainer.state.containerId,
      containerManifestHash: firstContainer.manifestHash,
    },
    dependencyManifestHashes: [firstContainer.manifestHash],
    objectId: "blob-document-a",
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const secondDocumentEvent = await createVerifiedDocumentAccessEvent({
    body: {
      eventType: "document.link",
      containerId: secondContainer.state.containerId,
      containerManifestHash: secondContainer.manifestHash,
    },
    dependencyManifestHashes: [secondContainer.manifestHash],
    objectId: "blob-document-b",
    organizationId: firstContainer.state.organizationId,
    previousManifestHash: null,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const firstDocumentManifest = await createDocumentLinkSetManifestFixture({
    documentId: "blob-document-a",
    event: firstDocumentEvent,
    linkedContainerIds: [
      secondContainer.state.containerId,
      firstContainer.state.containerId,
    ],
    organizationId: firstContainer.state.organizationId,
  });
  const secondDocumentManifest = await createDocumentLinkSetManifestFixture({
    documentId: "blob-document-b",
    event: secondDocumentEvent,
    linkedContainerIds: [secondContainer.state.containerId],
    organizationId: firstContainer.state.organizationId,
  });
  const firstKekState = await createVerifiedContainerKekStateFixture({
    manifest: firstContainer,
    recipientUserId: writerUserId,
  });
  const secondKekState = await createVerifiedContainerKekStateFixture({
    manifest: secondContainer,
    recipientUserId: writerUserId,
  });
  const firstBinding = await createVerifiedAttachmentBinding({
    bindingId: "binding-a",
    blobId: "blob-shared",
    documentManifest: firstDocumentManifest,
    signer: writerSigning,
    signerUserId: writerUserId,
    slotId: "slot-a",
    writePath: [firstContainer],
  });
  const secondBinding = await createVerifiedAttachmentBinding({
    bindingId: "binding-b",
    blobId: "blob-shared",
    documentManifest: secondDocumentManifest,
    signer: writerSigning,
    signerUserId: writerUserId,
    slotId: "slot-b",
    writePath: [secondContainer],
  });

  const result = await deriveBlobKekTargets({
    blobId: "blob-shared",
    activeBindings: [secondBinding, firstBinding],
    documentManifests: [secondDocumentManifest, firstDocumentManifest],
    linkedContainerManifests: [secondContainer, firstContainer],
    containerKekStates: [secondKekState, firstKekState],
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw result.error;
  }
  expect(result.value.targets).toEqual([
    {
      bindingId: "binding-a",
      documentId: "blob-document-a",
      containerId: firstContainer.state.containerId,
      containerManifestHash: firstContainer.manifestHash,
      containerKeyEpochId: firstKekState.containerKeyEpochId,
      containerKeyEpoch: firstKekState.containerKeyEpoch,
    },
    {
      bindingId: "binding-a",
      documentId: "blob-document-a",
      containerId: secondContainer.state.containerId,
      containerManifestHash: secondContainer.manifestHash,
      containerKeyEpochId: secondKekState.containerKeyEpochId,
      containerKeyEpoch: secondKekState.containerKeyEpoch,
    },
    {
      bindingId: "binding-b",
      documentId: "blob-document-b",
      containerId: secondContainer.state.containerId,
      containerManifestHash: secondContainer.manifestHash,
      containerKeyEpochId: secondKekState.containerKeyEpochId,
      containerKeyEpoch: secondKekState.containerKeyEpoch,
    },
  ]);
  expect(result.value.blobKeyTargetHash).toBe(
    await computeBlobContentKeyTargetHash(result.value.targets),
  );

  const omittedBindingResult = await deriveBlobKekTargets({
    blobId: "blob-shared",
    activeBindings: [firstBinding, secondBinding],
    documentManifests: [firstDocumentManifest],
    linkedContainerManifests: [firstContainer, secondContainer],
    containerKekStates: [firstKekState, secondKekState],
  });
  expectVerificationError(omittedBindingResult, "missing_dependency");

  const wrongBlobResult = await deriveBlobKekTargets({
    blobId: "other-blob",
    activeBindings: [firstBinding],
    documentManifests: [firstDocumentManifest],
    linkedContainerManifests: [firstContainer, secondContainer],
    containerKekStates: [firstKekState, secondKekState],
  });
  expectVerificationError(wrongBlobResult, "object_mismatch");
});

test("container managed-principal grants commit matching principal heads", async () => {
  const groupGrant: ContainerDirectGrantV2 = {
    subjectType: "group",
    subjectId: "group-1",
    accessLevel: "write",
  };
  const state: ContainerAccessManifestStateV2 = {
    version: 2,
    containerId: "container-1",
    organizationId: "organization-1",
    epoch: 1,
    previousManifestHash: null,
    eventHash: await fixtureHash("container-event"),
    parentContainerId: null,
    parentManifestHash: null,
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [groupGrant],
    referencedPrincipalHeads: [],
  };

  await expect(deriveContainerAccessManifest(state)).rejects.toThrow(
    "container access manifest is missing a referenced principal head",
  );

  await expect(
    deriveContainerAccessManifest({
      ...state,
      referencedPrincipalHeads: [
        {
          principalType: "group",
          principalId: groupGrant.subjectId,
          version: 1,
          keyEpoch: 1,
          stateHash: await fixtureHash("group-state"),
          keyFingerprint: await fixtureHash("group-key"),
        },
      ],
    }),
  ).resolves.toMatchObject({
    objectKind: "container",
    objectId: state.containerId,
  });
});

test("verifyContainerKekState derives user, principal, and parent wrap targets", async () => {
  const parentManifest = await createContainerManifestFixture({
    containerId: "parent-container",
    containerKeyEpochId: "parent-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: "parent-user",
        accessLevel: "admin",
      },
    ],
  });
  const parentUserKey: ContainerUserRecipientKeyV2 = {
    userId: "parent-user",
    recipientKeyEpochId: "parent-user-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("parent-user-key"),
  };
  const parentKeyEpoch = await createContainerKeyEpochFixture({
    manifest: parentManifest,
  });
  const parentWrap = await createContainerKeyWrap({
    containerKeyEpochId: parentKeyEpoch.id,
    recipientKind: "user",
    recipientId: parentUserKey.userId,
    recipientKeyEpochId: parentUserKey.recipientKeyEpochId,
    recipientKeyFingerprint: parentUserKey.recipientKeyFingerprint,
    wrapManifestHash: parentManifest.manifestHash,
  });
  const parentKekState = await verifyContainerKekState({
    containerManifest: parentManifest,
    keyEpoch: parentKeyEpoch,
    userRecipientKeys: [parentUserKey],
    wraps: [parentWrap],
  });

  expect(parentKekState.ok).toBe(true);
  if (!parentKekState.ok) {
    throw parentKekState.error;
  }

  const groupHead = {
    principalType: "group" as const,
    principalId: "group-1",
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("group-state"),
    keyFingerprint: await fixtureHash("group-key"),
  };
  const organizationHead = {
    principalType: "organization" as const,
    principalId: "organization-1",
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("organization-state"),
    keyFingerprint: await fixtureHash("organization-key"),
  };
  const childManifest = await createContainerManifestFixture({
    containerId: "child-container",
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: "alice",
        accessLevel: "read",
      },
      {
        subjectType: "group",
        subjectId: groupHead.principalId,
        accessLevel: "write",
      },
      {
        subjectType: "organization",
        subjectId: organizationHead.principalId,
        accessLevel: "read",
      },
    ],
    parentContainerId: parentManifest.state.containerId,
    parentManifestHash: parentManifest.manifestHash,
    referencedPrincipalHeads: [groupHead, organizationHead],
  });
  const aliceKey: ContainerUserRecipientKeyV2 = {
    userId: "alice",
    recipientKeyEpochId: "alice-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("alice-key"),
  };
  const childKeyEpoch = await createContainerKeyEpochFixture({
    manifest: childManifest,
    parentContainerKeyEpochId: parentKekState.value.containerKeyEpochId,
  });
  const childWraps = [
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "user",
      recipientId: aliceKey.userId,
      recipientKeyEpochId: aliceKey.recipientKeyEpochId,
      recipientKeyFingerprint: aliceKey.recipientKeyFingerprint,
      wrapManifestHash: childManifest.manifestHash,
    }),
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "group",
      recipientId: groupHead.principalId,
      recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(groupHead),
      recipientKeyFingerprint: groupHead.keyFingerprint,
      wrapManifestHash: childManifest.manifestHash,
    }),
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "organization",
      recipientId: organizationHead.principalId,
      recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(organizationHead),
      recipientKeyFingerprint: organizationHead.keyFingerprint,
      wrapManifestHash: childManifest.manifestHash,
    }),
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "container",
      recipientId: parentKekState.value.containerId,
      recipientKeyEpochId: parentKekState.value.containerKeyEpochId,
      recipientKeyFingerprint: parentKekState.value.keyEpochHash,
      wrapManifestHash: childManifest.manifestHash,
    }),
  ];
  const childKekState = await verifyContainerKekState({
    containerManifest: childManifest,
    keyEpoch: childKeyEpoch,
    parentKekState: parentKekState.value,
    principalPolicies: [
      createPrincipalPolicyFixture(groupHead),
      createPrincipalPolicyFixture(organizationHead),
    ],
    userRecipientKeys: [aliceKey],
    wraps: childWraps,
  });

  expect(childKekState.ok).toBe(true);
  if (childKekState.ok) {
    expect(childKekState.value.recipientTargets).toEqual([
      {
        recipientKind: "container",
        recipientId: parentKekState.value.containerId,
        recipientKeyEpochId: parentKekState.value.containerKeyEpochId,
        recipientKeyFingerprint: parentKekState.value.keyEpochHash,
      },
      {
        recipientKind: "group",
        recipientId: groupHead.principalId,
        recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(groupHead),
        recipientKeyFingerprint: groupHead.keyFingerprint,
      },
      {
        recipientKind: "organization",
        recipientId: organizationHead.principalId,
        recipientKeyEpochId:
          derivePrincipalRecipientKeyEpochId(organizationHead),
        recipientKeyFingerprint: organizationHead.keyFingerprint,
      },
      {
        recipientKind: "user",
        recipientId: aliceKey.userId,
        recipientKeyEpochId: aliceKey.recipientKeyEpochId,
        recipientKeyFingerprint: aliceKey.recipientKeyFingerprint,
      },
    ]);
  }
});

test("verifyContainerKekState rejects forged wrap fingerprints and parent edges", async () => {
  const parentManifest = await createContainerManifestFixture({
    containerId: "parent-container-for-reject",
    containerKeyEpochId: "parent-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: "parent-user",
        accessLevel: "admin",
      },
    ],
  });
  const parentUserKey: ContainerUserRecipientKeyV2 = {
    userId: "parent-user",
    recipientKeyEpochId: "parent-user-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("parent-user-key"),
  };
  const parentKeyEpoch = await createContainerKeyEpochFixture({
    manifest: parentManifest,
  });
  const parentWrap = await createContainerKeyWrap({
    containerKeyEpochId: parentKeyEpoch.id,
    recipientKind: "user",
    recipientId: parentUserKey.userId,
    recipientKeyEpochId: parentUserKey.recipientKeyEpochId,
    recipientKeyFingerprint: parentUserKey.recipientKeyFingerprint,
    wrapManifestHash: parentManifest.manifestHash,
  });
  const parentKekState = await verifyContainerKekState({
    containerManifest: parentManifest,
    keyEpoch: parentKeyEpoch,
    userRecipientKeys: [parentUserKey],
    wraps: [parentWrap],
  });

  if (!parentKekState.ok) {
    throw parentKekState.error;
  }

  const childManifest = await createContainerManifestFixture({
    containerId: "child-container-for-reject",
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: "alice",
        accessLevel: "read",
      },
    ],
    parentContainerId: parentManifest.state.containerId,
    parentManifestHash: parentManifest.manifestHash,
  });
  const aliceKey: ContainerUserRecipientKeyV2 = {
    userId: "alice",
    recipientKeyEpochId: "alice-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("alice-key"),
  };
  const childKeyEpoch = await createContainerKeyEpochFixture({
    manifest: childManifest,
    parentContainerKeyEpochId: parentKekState.value.containerKeyEpochId,
  });
  const childWraps = [
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "user",
      recipientId: aliceKey.userId,
      recipientKeyEpochId: aliceKey.recipientKeyEpochId,
      recipientKeyFingerprint: aliceKey.recipientKeyFingerprint,
      wrapManifestHash: childManifest.manifestHash,
    }),
    await createContainerKeyWrap({
      containerKeyEpochId: childKeyEpoch.id,
      recipientKind: "container",
      recipientId: parentKekState.value.containerId,
      recipientKeyEpochId: parentKekState.value.containerKeyEpochId,
      recipientKeyFingerprint: parentKekState.value.keyEpochHash,
      wrapManifestHash: childManifest.manifestHash,
    }),
  ];
  const [aliceWrap, parentContainerWrap] = childWraps;

  if (!aliceWrap || !parentContainerWrap) {
    throw new Error("Expected child wrap fixtures");
  }

  expectVerificationError(
    await verifyContainerKekState({
      containerManifest: childManifest,
      keyEpoch: childKeyEpoch,
      parentKekState: parentKekState.value,
      userRecipientKeys: [aliceKey],
      wraps: [
        { ...aliceWrap, recipientKeyFingerprint: await fixtureHash("bad") },
        parentContainerWrap,
      ],
    }),
    "hash_mismatch",
  );
  expectVerificationError(
    await verifyContainerKekState({
      containerManifest: childManifest,
      keyEpoch: {
        ...childKeyEpoch,
        parentContainerKeyEpochId: "wrong-parent-key-epoch",
      },
      parentKekState: parentKekState.value,
      userRecipientKeys: [aliceKey],
      wraps: childWraps,
    }),
    "key_epoch_reuse",
  );
});

test("verifyContainerKekState accepts additive wraps on the existing KEK epoch", async () => {
  const originalManifest = await createContainerManifestFixture({
    containerId: "additive-container",
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: "alice",
        accessLevel: "read",
      },
    ],
  });
  const currentManifest = await createContainerManifestFixture({
    containerId: originalManifest.state.containerId,
    containerKeyEpochId: originalManifest.state.containerKeyEpochId,
    directGrants: [
      ...originalManifest.state.directGrants,
      {
        subjectType: "user",
        subjectId: "bob",
        accessLevel: "read",
      },
    ],
    epoch: 2,
    previousManifestHash: originalManifest.manifestHash,
  });
  const aliceKey: ContainerUserRecipientKeyV2 = {
    userId: "alice",
    recipientKeyEpochId: "alice-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("alice-key"),
  };
  const bobKey: ContainerUserRecipientKeyV2 = {
    userId: "bob",
    recipientKeyEpochId: "bob-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("bob-key"),
  };
  const keyEpoch = await createContainerKeyEpochFixture({
    manifest: currentManifest,
    createdByManifest: originalManifest,
  });
  const state = await verifyContainerKekState({
    containerManifest: currentManifest,
    containerManifestHistory: [originalManifest],
    keyEpoch,
    userRecipientKeys: [aliceKey, bobKey],
    wraps: [
      await createContainerKeyWrap({
        containerKeyEpochId: keyEpoch.id,
        recipientKind: "user",
        recipientId: aliceKey.userId,
        recipientKeyEpochId: aliceKey.recipientKeyEpochId,
        recipientKeyFingerprint: aliceKey.recipientKeyFingerprint,
        wrapManifestHash: originalManifest.manifestHash,
      }),
      await createContainerKeyWrap({
        containerKeyEpochId: keyEpoch.id,
        recipientKind: "user",
        recipientId: bobKey.userId,
        recipientKeyEpochId: bobKey.recipientKeyEpochId,
        recipientKeyFingerprint: bobKey.recipientKeyFingerprint,
        wrapManifestHash: currentManifest.manifestHash,
      }),
    ],
  });

  expect(state.ok).toBe(true);
  if (state.ok) {
    expect(state.value.containerKeyEpochId).toBe("container-key-epoch-1");
    expect(state.value.wraps.map((wrap) => wrap.wrapManifestHash)).toEqual([
      originalManifest.manifestHash,
      currentManifest.manifestHash,
    ]);
  }
});

test("verifyContainerAccessManifest requires revokes to advance the KEK epoch", async () => {
  const adminSigning = generateSigningSeedAndKeyPair();
  const previous = await createContainerManifestFixture({
    containerId: "revoke-container",
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: "admin-user",
        accessLevel: "admin",
      },
      {
        subjectType: "user",
        subjectId: "revoked-user",
        accessLevel: "read",
      },
    ],
    signer: adminSigning,
    signerUserId: "admin-user",
  });
  const body: ContainerAccessEventBodyV2 = {
    eventType: "container.revoke",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    subjectType: "user",
    subjectId: "revoked-user",
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: adminSigning,
    signerUserId: "admin-user",
  });

  expectVerificationError(
    await verifyContainerAccessManifest({
      manifest: previous.manifest,
      expectedManifestHash: previous.manifestHash,
      event,
      previousManifest: previous,
      previousContainerPath: [previous],
    }),
    "key_epoch_reuse",
  );
});

test("write headers are signed, hashed, and verified against expected targets", async () => {
  const signing = generateSigningSeedAndKeyPair();
  const accessManifestHash = await fixtureHash("write-access-manifest");
  const targetHash = await fixtureHash("write-targets");
  const header = await signWriteHeader(
    {
      version: 2,
      objectKind: "document",
      objectId: "document-1",
      accessManifestHash,
      contentKeyEpoch: 1,
      targetHash,
      metadataHash: await fixtureHash("metadata"),
      ciphertextHash: await fixtureHash("ciphertext"),
      writerUserId: "user-1",
      writerDeviceId: "device-1",
      writerKeyFingerprint: await toFingerprint(signing.signingPublicKey),
      signedAt: "2026-04-25T12:00:00.000Z",
    },
    signing.signingPrivateKey,
  );

  const verified = await verifyWriteHeader({
    header,
    writerPublicKey: signing.signingPublicKey,
    expectedObject: {
      objectKind: "document",
      objectId: "document-1",
    },
    expectedAccessManifestHash: accessManifestHash,
    expectedTargetHash: targetHash,
  });
  expect(verified.ok).toBe(true);
  if (verified.ok) {
    expect(verified.value.headerHash).toBe(
      await computeWriteHeaderHash(header),
    );
  }

  const staleTarget = await verifyWriteHeader({
    header,
    writerPublicKey: signing.signingPublicKey,
    expectedTargetHash: await fixtureHash("stale-target"),
  });
  expectVerificationError(staleTarget, "hash_mismatch");
});
