import { expect, test } from "bun:test";
import { toFingerprint } from "../fingerprint";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import type { AccessEvent, AccessManifestCheckpoint } from "./index";
import {
  computeAccessManifestHash,
  computeKeyingDomainHash,
  verifyAccessManifest,
  verifySignedAccessEvent,
} from "./index";
import {
  createManifest,
  createSignedContainerEvent,
  createVerifiedAccessManifestCheckpointFixture,
  createVerifiedEvent,
  expectVerificationError,
  fixtureHash,
} from "./testFixtures";

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
    event: { ...fixture.event, extra: "not allowed" } as AccessEvent,
    signerPublicKey: fixture.signingPublicKey,
  });
  expectVerificationError(extraFieldResult, "invalid_shape");

  const missingObjectId = { ...fixture.event } as Partial<AccessEvent>;
  delete missingObjectId.objectId;
  const missingFieldResult = await verifySignedAccessEvent({
    body: fixture.body,
    event: missingObjectId as AccessEvent,
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

  const wrongDomainBodyHash = await computeKeyingDomainHash(
    "tearleads.keying.document-content-key-targets",
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

test("verifyAccessManifest rejects rollback and equivocation against local checkpoints", async () => {
  const first = await createVerifiedAccessManifestCheckpointFixture({
    epoch: 1,
    previousManifestHash: null,
  });
  const second = await createVerifiedAccessManifestCheckpointFixture({
    epoch: 2,
    previousManifestHash: first.manifestHash,
  });
  const checkpoint: AccessManifestCheckpoint = second.checkpoint;

  const rollback = await verifyAccessManifest({
    manifest: first.manifest,
    expectedManifestHash: first.manifestHash,
    event: first.event,
    localCheckpoint: checkpoint,
  });
  expectVerificationError(rollback, "rollback");

  const alternateSecond = await createVerifiedAccessManifestCheckpointFixture({
    epoch: 2,
    previousManifestHash: first.manifestHash,
    structuralLabel: "alternate-second-structural",
  });
  const equivocation = await verifyAccessManifest({
    manifest: alternateSecond.manifest,
    expectedManifestHash: alternateSecond.manifestHash,
    event: alternateSecond.event,
    localCheckpoint: checkpoint,
  });
  expectVerificationError(equivocation, "equivocation");
});

test("verifyAccessManifest requires a verified predecessor chain to advance past a checkpoint gap", async () => {
  const first = await createVerifiedAccessManifestCheckpointFixture({
    epoch: 1,
    previousManifestHash: null,
  });
  const second = await createVerifiedAccessManifestCheckpointFixture({
    epoch: 2,
    previousManifestHash: first.manifestHash,
  });
  const third = await createVerifiedAccessManifestCheckpointFixture({
    epoch: 3,
    previousManifestHash: second.manifestHash,
  });

  const missingProof = await verifyAccessManifest({
    manifest: third.manifest,
    expectedManifestHash: third.manifestHash,
    event: third.event,
    localCheckpoint: first.checkpoint,
  });
  expectVerificationError(missingProof, "stale_predecessor");

  const withProof = await verifyAccessManifest({
    manifest: third.manifest,
    expectedManifestHash: third.manifestHash,
    event: third.event,
    localCheckpoint: first.checkpoint,
    checkpointPredecessors: [second],
  });
  expect(withProof.ok).toBe(true);
  if (withProof.ok) {
    expect(withProof.value.checkpoint).toEqual(third.checkpoint);
  }
});
