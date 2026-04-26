import type {
  AccessObjectKindV2,
  KeyingV2CanonicalJson,
  ReferencedPrincipalHeadV2,
  VerifiedAccessEvent,
  VerifiedAccessManifest,
} from "@tearleads/crypto";
import { serializeKeyingV2CanonicalJson } from "@tearleads/crypto";
import { and, asc, eq } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import {
  accessEventDependencyProjection,
  accessEvents,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
} from "../schema";

/**
 * V2 access projection tables are derived cache only.
 *
 * Callers must verify signed access events and manifests with the crypto
 * package before trusting any row returned here for authorization decisions.
 */

type AccessManifestStoreExecutor = DatabaseExecutor;

interface StoredAccessManifestHead {
  readonly objectKind: AccessObjectKindV2;
  readonly objectId: string;
  readonly organizationId: string;
  readonly epoch: number;
  readonly manifestHash: string;
  readonly updatedAt: Date;
}

interface StoredAccessEventDependencyProjection {
  readonly eventHash: string;
  readonly objectKind: AccessObjectKindV2;
  readonly objectId: string;
  readonly dependencyManifestHash: string;
  readonly dependencyIndex: number;
}

interface StoredAccessManifestPrincipalHeadProjection
  extends ReferencedPrincipalHeadV2 {
  readonly manifestHash: string;
  readonly objectKind: AccessObjectKindV2;
  readonly objectId: string;
}

interface StoreVerifiedAccessManifestInput {
  readonly verifiedManifest: VerifiedAccessManifest;
}

function accessEventDependencyHashes(event: VerifiedAccessEvent): string[] {
  return [...event.event.dependencyManifestHashes];
}

function accessManifestReferencedHeads(
  manifest: VerifiedAccessManifest,
): ReferencedPrincipalHeadV2[] {
  return manifest.manifest.referencedPrincipalHeads.map((principalHead) => ({
    ...principalHead,
  }));
}

function referencedPrincipalHeadsCanonicalJson(
  principalHeads: readonly ReferencedPrincipalHeadV2[],
): KeyingV2CanonicalJson {
  return principalHeads.map((principalHead) => ({
    principalType: principalHead.principalType,
    principalId: principalHead.principalId,
    version: principalHead.version,
    keyEpoch: principalHead.keyEpoch,
    stateHash: principalHead.stateHash,
    keyFingerprint: principalHead.keyFingerprint,
  }));
}

function canonicalJsonMatches(
  left: KeyingV2CanonicalJson,
  right: KeyingV2CanonicalJson,
): boolean {
  return (
    serializeKeyingV2CanonicalJson(left) ===
    serializeKeyingV2CanonicalJson(right)
  );
}

function readJsonArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is not an array`);
  }

  return value as T[];
}

function toStoredAccessManifestHead(
  row: typeof accessManifestHeads.$inferSelect,
): StoredAccessManifestHead {
  return {
    objectKind: row.objectKind,
    objectId: row.objectId,
    organizationId: row.organizationId,
    epoch: row.epoch,
    manifestHash: row.manifestHash,
    updatedAt: row.updatedAt,
  };
}

async function insertAccessEvent(
  verifiedEvent: VerifiedAccessEvent,
  executor: AccessManifestStoreExecutor,
): Promise<void> {
  const event = verifiedEvent.event;

  const [insertedEvent] = await executor
    .insert(accessEvents)
    .values({
      version: event.version,
      eventId: event.eventId,
      eventType: event.eventType,
      objectKind: event.objectKind,
      objectId: event.objectId,
      organizationId: event.organizationId,
      previousManifestHash: event.previousManifestHash,
      dependencyManifestHashes: accessEventDependencyHashes(verifiedEvent),
      bodyHash: event.bodyHash,
      body: verifiedEvent.body,
      eventHash: verifiedEvent.eventHash,
      signerUserId: event.signerUserId,
      signerDeviceId: event.signerDeviceId,
      signerKeyFingerprint: event.signerKeyFingerprint,
      signature: event.signature,
      signedAt: new Date(event.signedAt),
    })
    .onConflictDoNothing({ target: accessEvents.eventHash })
    .returning();

  if (!insertedEvent) {
    await ensureStoredAccessEventMatches(verifiedEvent, executor);
  }
}

async function ensureStoredAccessEventMatches(
  verifiedEvent: VerifiedAccessEvent,
  executor: AccessManifestStoreExecutor,
): Promise<void> {
  const [storedEvent] = await executor
    .select()
    .from(accessEvents)
    .where(eq(accessEvents.eventHash, verifiedEvent.eventHash))
    .limit(1);

  if (!storedEvent) {
    throw new Error("Failed to load stored access event");
  }

  const event = verifiedEvent.event;
  if (
    storedEvent.version !== event.version ||
    storedEvent.eventId !== event.eventId ||
    storedEvent.eventType !== event.eventType ||
    storedEvent.objectKind !== event.objectKind ||
    storedEvent.objectId !== event.objectId ||
    storedEvent.organizationId !== event.organizationId ||
    storedEvent.previousManifestHash !== event.previousManifestHash ||
    !canonicalJsonMatches(
      storedEvent.dependencyManifestHashes,
      accessEventDependencyHashes(verifiedEvent),
    ) ||
    storedEvent.bodyHash !== event.bodyHash ||
    !canonicalJsonMatches(storedEvent.body, verifiedEvent.body) ||
    storedEvent.signerUserId !== event.signerUserId ||
    storedEvent.signerDeviceId !== event.signerDeviceId ||
    storedEvent.signerKeyFingerprint !== event.signerKeyFingerprint ||
    storedEvent.signature !== event.signature ||
    storedEvent.signedAt.getTime() !== new Date(event.signedAt).getTime()
  ) {
    throw new Error("Access event conflict");
  }
}

async function insertAccessManifest(
  verifiedManifest: VerifiedAccessManifest,
  executor: AccessManifestStoreExecutor,
): Promise<void> {
  const manifest = verifiedManifest.manifest;

  const [insertedManifest] = await executor
    .insert(accessManifests)
    .values({
      version: manifest.version,
      objectKind: manifest.objectKind,
      objectId: manifest.objectId,
      organizationId: manifest.organizationId,
      epoch: manifest.epoch,
      previousManifestHash: manifest.previousManifestHash,
      eventHash: manifest.eventHash,
      structuralHash: manifest.structuralHash,
      grantRoot: manifest.grantRoot,
      referencedPrincipalHeads: accessManifestReferencedHeads(verifiedManifest),
      keyTargetHash: manifest.keyTargetHash,
      manifestHash: verifiedManifest.manifestHash,
    })
    .onConflictDoNothing({ target: accessManifests.manifestHash })
    .returning();

  if (!insertedManifest) {
    await ensureStoredAccessManifestMatches(verifiedManifest, executor);
  }
}

async function ensureStoredAccessManifestMatches(
  verifiedManifest: VerifiedAccessManifest,
  executor: AccessManifestStoreExecutor,
): Promise<void> {
  const [storedManifest] = await executor
    .select()
    .from(accessManifests)
    .where(eq(accessManifests.manifestHash, verifiedManifest.manifestHash))
    .limit(1);

  if (!storedManifest) {
    throw new Error("Failed to load stored access manifest");
  }

  const manifest = verifiedManifest.manifest;
  if (
    storedManifest.version !== manifest.version ||
    storedManifest.objectKind !== manifest.objectKind ||
    storedManifest.objectId !== manifest.objectId ||
    storedManifest.organizationId !== manifest.organizationId ||
    storedManifest.epoch !== manifest.epoch ||
    storedManifest.previousManifestHash !== manifest.previousManifestHash ||
    storedManifest.eventHash !== manifest.eventHash ||
    storedManifest.structuralHash !== manifest.structuralHash ||
    storedManifest.grantRoot !== manifest.grantRoot ||
    !canonicalJsonMatches(
      referencedPrincipalHeadsCanonicalJson(
        storedManifest.referencedPrincipalHeads,
      ),
      referencedPrincipalHeadsCanonicalJson(
        accessManifestReferencedHeads(verifiedManifest),
      ),
    ) ||
    storedManifest.keyTargetHash !== manifest.keyTargetHash
  ) {
    throw new Error("Access manifest conflict");
  }
}

async function loadAccessManifestRow(
  manifestHash: string,
  executor: AccessManifestStoreExecutor,
): Promise<typeof accessManifests.$inferSelect> {
  const [manifest] = await executor
    .select()
    .from(accessManifests)
    .where(eq(accessManifests.manifestHash, manifestHash))
    .limit(1);

  if (!manifest) {
    throw new Error("Access manifest not found");
  }

  return manifest;
}

async function loadAccessEventRow(
  eventHash: string,
  executor: AccessManifestStoreExecutor,
): Promise<typeof accessEvents.$inferSelect> {
  const [event] = await executor
    .select()
    .from(accessEvents)
    .where(eq(accessEvents.eventHash, eventHash))
    .limit(1);

  if (!event) {
    throw new Error("Access event not found");
  }

  return event;
}

async function regenerateAccessEventDependencyProjection(
  event: typeof accessEvents.$inferSelect,
  executor: AccessManifestStoreExecutor,
): Promise<void> {
  await executor
    .delete(accessEventDependencyProjection)
    .where(eq(accessEventDependencyProjection.eventHash, event.eventHash));

  const dependencyHashes = readJsonArray<string>(
    event.dependencyManifestHashes,
    "access event dependency projection source",
  );

  if (dependencyHashes.length === 0) {
    return;
  }

  await executor.insert(accessEventDependencyProjection).values(
    dependencyHashes.map((dependencyManifestHash, dependencyIndex) => ({
      eventHash: event.eventHash,
      objectKind: event.objectKind,
      objectId: event.objectId,
      dependencyManifestHash,
      dependencyIndex,
    })),
  );
}

async function regenerateAccessManifestPrincipalProjection(
  manifest: typeof accessManifests.$inferSelect,
  executor: AccessManifestStoreExecutor,
): Promise<void> {
  await executor
    .delete(accessManifestPrincipalHeadProjection)
    .where(
      eq(
        accessManifestPrincipalHeadProjection.manifestHash,
        manifest.manifestHash,
      ),
    );

  const referencedPrincipalHeads = readJsonArray<ReferencedPrincipalHeadV2>(
    manifest.referencedPrincipalHeads,
    "access manifest principal projection source",
  );

  if (referencedPrincipalHeads.length === 0) {
    return;
  }

  await executor.insert(accessManifestPrincipalHeadProjection).values(
    referencedPrincipalHeads.map((principalHead) => ({
      manifestHash: manifest.manifestHash,
      objectKind: manifest.objectKind,
      objectId: manifest.objectId,
      principalType: principalHead.principalType,
      principalId: principalHead.principalId,
      version: principalHead.version,
      keyEpoch: principalHead.keyEpoch,
      stateHash: principalHead.stateHash,
      keyFingerprint: principalHead.keyFingerprint,
    })),
  );
}

export async function regenerateAccessManifestProjections(
  manifestHash: string,
  executor: AccessManifestStoreExecutor = db,
): Promise<void> {
  if (executor === db) {
    return db.transaction(async (tx) =>
      regenerateAccessManifestProjections(manifestHash, tx),
    );
  }

  const manifest = await loadAccessManifestRow(manifestHash, executor);
  const event = await loadAccessEventRow(manifest.eventHash, executor);

  await regenerateAccessEventDependencyProjection(event, executor);
  await regenerateAccessManifestPrincipalProjection(manifest, executor);
}

async function loadCurrentAccessManifestHead(
  objectKind: AccessObjectKindV2,
  objectId: string,
  executor: AccessManifestStoreExecutor,
): Promise<StoredAccessManifestHead | null> {
  const [head] = await executor
    .select()
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, objectKind),
        eq(accessManifestHeads.objectId, objectId),
      ),
    )
    .limit(1);

  return head ? toStoredAccessManifestHead(head) : null;
}

async function advanceAccessManifestHead(
  verifiedManifest: VerifiedAccessManifest,
  executor: AccessManifestStoreExecutor,
): Promise<StoredAccessManifestHead> {
  const manifest = verifiedManifest.manifest;
  const currentHead = await loadCurrentAccessManifestHead(
    manifest.objectKind,
    manifest.objectId,
    executor,
  );

  if (!currentHead) {
    const [insertedHead] = await executor
      .insert(accessManifestHeads)
      .values({
        objectKind: manifest.objectKind,
        objectId: manifest.objectId,
        organizationId: manifest.organizationId,
        epoch: manifest.epoch,
        manifestHash: verifiedManifest.manifestHash,
      })
      .returning();

    if (!insertedHead) {
      throw new Error("Failed to load stored access manifest head");
    }
    return toStoredAccessManifestHead(insertedHead);
  }

  if (
    manifest.epoch === currentHead.epoch &&
    verifiedManifest.manifestHash !== currentHead.manifestHash
  ) {
    throw new Error("Access manifest head epoch conflict");
  }

  if (manifest.epoch <= currentHead.epoch) {
    return currentHead;
  }

  const [updatedHead] = await executor
    .update(accessManifestHeads)
    .set({
      organizationId: manifest.organizationId,
      epoch: manifest.epoch,
      manifestHash: verifiedManifest.manifestHash,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(accessManifestHeads.objectKind, manifest.objectKind),
        eq(accessManifestHeads.objectId, manifest.objectId),
      ),
    )
    .returning();

  if (!updatedHead) {
    throw new Error("Failed to load updated access manifest head");
  }
  return toStoredAccessManifestHead(updatedHead);
}

export async function storeVerifiedAccessManifest(
  input: StoreVerifiedAccessManifestInput,
  executor: AccessManifestStoreExecutor = db,
): Promise<StoredAccessManifestHead> {
  if (executor === db) {
    return db.transaction(async (tx) => storeVerifiedAccessManifest(input, tx));
  }

  await insertAccessEvent(input.verifiedManifest.event, executor);
  await insertAccessManifest(input.verifiedManifest, executor);
  await regenerateAccessManifestProjections(
    input.verifiedManifest.manifestHash,
    executor,
  );

  return advanceAccessManifestHead(input.verifiedManifest, executor);
}

export async function getCurrentAccessManifestHead(
  objectKind: AccessObjectKindV2,
  objectId: string,
  executor: AccessManifestStoreExecutor = db,
): Promise<StoredAccessManifestHead | null> {
  return loadCurrentAccessManifestHead(objectKind, objectId, executor);
}

export async function listAccessEventDependencyProjection(
  eventHash: string,
  executor: AccessManifestStoreExecutor = db,
): Promise<StoredAccessEventDependencyProjection[]> {
  return executor
    .select({
      eventHash: accessEventDependencyProjection.eventHash,
      objectKind: accessEventDependencyProjection.objectKind,
      objectId: accessEventDependencyProjection.objectId,
      dependencyManifestHash:
        accessEventDependencyProjection.dependencyManifestHash,
      dependencyIndex: accessEventDependencyProjection.dependencyIndex,
    })
    .from(accessEventDependencyProjection)
    .where(eq(accessEventDependencyProjection.eventHash, eventHash))
    .orderBy(asc(accessEventDependencyProjection.dependencyIndex));
}

export async function listAccessManifestPrincipalHeadProjection(
  manifestHash: string,
  executor: AccessManifestStoreExecutor = db,
): Promise<StoredAccessManifestPrincipalHeadProjection[]> {
  return executor
    .select({
      manifestHash: accessManifestPrincipalHeadProjection.manifestHash,
      objectKind: accessManifestPrincipalHeadProjection.objectKind,
      objectId: accessManifestPrincipalHeadProjection.objectId,
      principalType: accessManifestPrincipalHeadProjection.principalType,
      principalId: accessManifestPrincipalHeadProjection.principalId,
      version: accessManifestPrincipalHeadProjection.version,
      keyEpoch: accessManifestPrincipalHeadProjection.keyEpoch,
      stateHash: accessManifestPrincipalHeadProjection.stateHash,
      keyFingerprint: accessManifestPrincipalHeadProjection.keyFingerprint,
    })
    .from(accessManifestPrincipalHeadProjection)
    .where(eq(accessManifestPrincipalHeadProjection.manifestHash, manifestHash))
    .orderBy(
      asc(accessManifestPrincipalHeadProjection.principalType),
      asc(accessManifestPrincipalHeadProjection.principalId),
    );
}
