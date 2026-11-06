import { toFingerprint } from "../fingerprint";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { computeAccessEventHash } from "./accessEvent";
import { normalizeCanonicalJsonValue } from "./canonical";
import { fixtureHash } from "./canonical.testFixtures";
import type {
  AccessManifest,
  ContainerAccessEventBody,
  DocumentAccessEventBody,
  KeyingCanonicalJson,
  UnsignedAccessEvent,
  VerifiedAccessEvent,
  VerifiedAccessManifest,
} from "./index";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContainerKekRecipientTargetHash,
  makeVerifiedAccessEvent,
  signAccessEvent,
  verifyAccessManifest,
  verifySignedAccessEvent,
} from "./index";

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

// verifySignedAccessEvent's result for an event just signed from this body and
// signer (accessEvent.testFixtures.test.ts pins it); overrides must use the verifier.
async function trustFixtureSignature(
  body: ContainerAccessEventBody | DocumentAccessEventBody,
  event: Awaited<ReturnType<typeof signAccessEvent>>,
): Promise<VerifiedAccessEvent> {
  return makeVerifiedAccessEvent({
    body: normalizeCanonicalJsonValue(
      body as unknown as KeyingCanonicalJson,
      "access event body",
    ),
    event,
    eventHash: await computeAccessEventHash(event),
  });
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
  return trustFixtureSignature(input.body, event);
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
  return trustFixtureSignature(input.body, event);
}
