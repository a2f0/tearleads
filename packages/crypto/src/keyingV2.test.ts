import { expect, test } from "bun:test";
import { toFingerprint } from "./fingerprint";
import type {
  AccessEventV2,
  AccessManifestV2,
  ContainerAccessEventBodyV2,
  ContainerAccessManifestStateV2,
  ContainerCreateAccessEventBodyV2,
  ContainerDirectGrantV2,
  ContainerKekTargetV2,
  KeyingV2CanonicalJson,
  KeyingV2VerificationCode,
  KeyingV2VerificationResult,
  UnsignedAccessEventV2,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
} from "./keyingV2";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContainerKekRecipientTargetHash,
  computeDocumentContentKeyTargetHash,
  computeKeyingV2DomainHash,
  computeWriteHeaderHash,
  deriveContainerAccessManifest,
  serializeKeyingV2CanonicalJson,
  signAccessEvent,
  signWriteHeader,
  verifyAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerParentEdge,
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
      dependencyManifestHashes: [],
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
