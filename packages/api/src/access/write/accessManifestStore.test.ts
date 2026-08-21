import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  accessEventDependencyProjection,
  accessManifestPrincipalHeadProjection,
} from "@symcrypt/api-shared/schema";
import {
  type AccessManifest,
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  generateSigningSeedAndKeyPair,
  signAccessEvent,
  toFingerprint,
  type VerifiedAccessManifest,
  verifyAccessManifest,
  verifySignedAccessEvent,
} from "@symcrypt/crypto";
import { eq } from "drizzle-orm";
import {
  getCurrentAccessManifestHead,
  listAccessEventDependencyProjection,
  listAccessManifestPrincipalHeadProjection,
} from "../read/accessManifestStore";
import {
  regenerateAccessManifestProjections,
  storeVerifiedAccessManifest,
} from "./accessManifestStore";

function hashOf(char: string): string {
  return char.repeat(64);
}

async function createVerifiedAccessManifest(input: {
  dependencyManifestHashes?: string[];
  epoch?: number;
  objectId?: string;
  organizationId?: string;
  previousManifestHash?: string | null;
  referencedPrincipalHeads?: AccessManifest["referencedPrincipalHeads"];
  salt?: string;
}): Promise<VerifiedAccessManifest> {
  const objectId = input.objectId ?? crypto.randomUUID();
  const organizationId = input.organizationId ?? crypto.randomUUID();
  const epoch = input.epoch ?? 1;
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signerKeyFingerprint = await toFingerprint(signingPublicKey);
  const body = {
    accessLevel: "admin",
    recipientId: crypto.randomUUID(),
    salt: input.salt ?? crypto.randomUUID(),
  };
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: "container.grant",
      objectKind: "container",
      objectId,
      organizationId,
      previousManifestHash: input.previousManifestHash ?? null,
      dependencyManifestHashes: input.dependencyManifestHashes ?? [],
      bodyHash: await computeAccessEventBodyHash(body),
      signerUserId: crypto.randomUUID(),
      signerDeviceId: "device-1",
      signerKeyFingerprint,
      signedAt: new Date(`2026-04-0${epoch}T00:00:00.000Z`).toISOString(),
    },
    signingPrivateKey,
  );
  const verifiedEvent = await verifySignedAccessEvent({
    body,
    event,
    signerPublicKey: signingPublicKey,
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  const manifest: AccessManifest = {
    version: 1,
    objectKind: "container",
    objectId,
    organizationId,
    epoch,
    previousManifestHash: input.previousManifestHash ?? null,
    eventHash: verifiedEvent.value.eventHash,
    structuralHash: hashOf("a"),
    grantRoot: hashOf("b"),
    referencedPrincipalHeads: input.referencedPrincipalHeads ?? [],
    keyTargetHash: hashOf("c"),
  };
  const expectedManifestHash = await computeAccessManifestHash(manifest);
  const verifiedManifest = await verifyAccessManifest({
    event: verifiedEvent.value,
    expectedManifestHash,
    expectedObject: { objectKind: "container", objectId },
    expectedPreviousManifestHash: input.previousManifestHash ?? null,
    manifest,
  });

  if (!verifiedManifest.ok) {
    throw verifiedManifest.error;
  }

  return verifiedManifest.value;
}

test("storeVerifiedAccessManifest persists event, manifest, head, and derived projections", async () => {
  const referencedPrincipalHead = {
    principalType: "group" as const,
    principalId: crypto.randomUUID(),
    version: 1,
    keyEpoch: 1,
    stateHash: hashOf("d"),
    keyFingerprint: hashOf("e"),
  };
  const verifiedManifest = await createVerifiedAccessManifest({
    dependencyManifestHashes: [hashOf("0"), hashOf("1")],
    referencedPrincipalHeads: [referencedPrincipalHead],
  });

  const head = await storeVerifiedAccessManifest({ verifiedManifest }, db);

  expect(head).toMatchObject({
    objectKind: "container",
    objectId: verifiedManifest.manifest.objectId,
    organizationId: verifiedManifest.manifest.organizationId,
    epoch: 1,
    manifestHash: verifiedManifest.manifestHash,
  });
  await expect(
    getCurrentAccessManifestHead(
      "container",
      verifiedManifest.manifest.objectId,
      db,
    ),
  ).resolves.toMatchObject({
    epoch: 1,
    manifestHash: verifiedManifest.manifestHash,
  });
  await expect(
    listAccessEventDependencyProjection(verifiedManifest.event.eventHash, db),
  ).resolves.toEqual([
    {
      eventHash: verifiedManifest.event.eventHash,
      objectKind: "container",
      objectId: verifiedManifest.manifest.objectId,
      dependencyManifestHash: hashOf("0"),
      dependencyIndex: 0,
    },
    {
      eventHash: verifiedManifest.event.eventHash,
      objectKind: "container",
      objectId: verifiedManifest.manifest.objectId,
      dependencyManifestHash: hashOf("1"),
      dependencyIndex: 1,
    },
  ]);
  await expect(
    listAccessManifestPrincipalHeadProjection(
      verifiedManifest.manifestHash,
      db,
    ),
  ).resolves.toEqual([
    {
      manifestHash: verifiedManifest.manifestHash,
      objectKind: "container",
      objectId: verifiedManifest.manifest.objectId,
      ...referencedPrincipalHead,
    },
  ]);
});

test("access manifest projections can be regenerated from stored event and manifest rows", async () => {
  const verifiedManifest = await createVerifiedAccessManifest({
    dependencyManifestHashes: [hashOf("2")],
    referencedPrincipalHeads: [
      {
        principalType: "organization",
        principalId: crypto.randomUUID(),
        version: 1,
        keyEpoch: 3,
        stateHash: hashOf("3"),
        keyFingerprint: hashOf("4"),
      },
    ],
  });
  await storeVerifiedAccessManifest({ verifiedManifest }, db);

  await db
    .delete(accessEventDependencyProjection)
    .where(
      eq(
        accessEventDependencyProjection.eventHash,
        verifiedManifest.event.eventHash,
      ),
    );
  await db
    .delete(accessManifestPrincipalHeadProjection)
    .where(
      eq(
        accessManifestPrincipalHeadProjection.manifestHash,
        verifiedManifest.manifestHash,
      ),
    );

  await expect(
    listAccessEventDependencyProjection(verifiedManifest.event.eventHash, db),
  ).resolves.toEqual([]);
  await expect(
    listAccessManifestPrincipalHeadProjection(
      verifiedManifest.manifestHash,
      db,
    ),
  ).resolves.toEqual([]);

  await regenerateAccessManifestProjections(verifiedManifest.manifestHash, db);

  await expect(
    listAccessEventDependencyProjection(verifiedManifest.event.eventHash, db),
  ).resolves.toHaveLength(1);
  await expect(
    listAccessManifestPrincipalHeadProjection(
      verifiedManifest.manifestHash,
      db,
    ),
  ).resolves.toHaveLength(1);
});

test("access manifest uniqueness rejects two hashes for the same object epoch", async () => {
  const objectId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const firstManifest = await createVerifiedAccessManifest({
    objectId,
    organizationId,
    salt: "first",
  });
  const conflictingManifest = await createVerifiedAccessManifest({
    objectId,
    organizationId,
    salt: "second",
  });

  await storeVerifiedAccessManifest({ verifiedManifest: firstManifest }, db);

  await expect(
    storeVerifiedAccessManifest({ verifiedManifest: conflictingManifest }, db),
  ).rejects.toThrow();
  await expect(
    getCurrentAccessManifestHead("container", objectId, db),
  ).resolves.toMatchObject({
    epoch: 1,
    manifestHash: firstManifest.manifestHash,
  });
});

test("access manifest current head advances monotonically", async () => {
  const objectId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const firstManifest = await createVerifiedAccessManifest({
    objectId,
    organizationId,
  });
  const secondManifest = await createVerifiedAccessManifest({
    dependencyManifestHashes: [firstManifest.manifestHash],
    epoch: 2,
    objectId,
    organizationId,
    previousManifestHash: firstManifest.manifestHash,
  });

  await storeVerifiedAccessManifest({ verifiedManifest: firstManifest }, db);
  await storeVerifiedAccessManifest({ verifiedManifest: secondManifest }, db);
  await storeVerifiedAccessManifest({ verifiedManifest: firstManifest }, db);

  await expect(
    getCurrentAccessManifestHead("container", objectId, db),
  ).resolves.toMatchObject({
    epoch: 2,
    manifestHash: secondManifest.manifestHash,
  });
});
