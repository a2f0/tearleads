import { expect, test } from "bun:test";
import { toFingerprint } from "./fingerprint";
import type {
  AccessEventV2,
  AccessManifestV2,
  ContainerKekTargetV2,
  KeyingV2VerificationCode,
  KeyingV2VerificationResult,
  UnsignedAccessEventV2,
  VerifiedAccessEvent,
} from "./keyingV2";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContainerKekRecipientTargetHash,
  computeDocumentContentKeyTargetHash,
  computeKeyingV2DomainHash,
  computeWriteHeaderHash,
  serializeKeyingV2CanonicalJson,
  signAccessEvent,
  signWriteHeader,
  verifyAccessManifest,
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

test("keying v2 canonical JSON sorts object keys deterministically", () => {
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
