import type {
  AccessManifest,
  AccessObjectKind,
  AnyVerifiedAccessManifest,
  ContainerAccessManifestState,
  DocumentLinkSetManifestState,
  KeyingCanonicalJson,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import {
  accessEventDependencyProjection,
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
} from "../schema";

/**
 * access projection tables are derived cache only.
 *
 * Callers must verify signed access events and manifests with the crypto
 * package before trusting any row returned here for authorization decisions.
 */

type AccessManifestStoreExecutor = DatabaseExecutor;

interface StoredAccessManifestHead {
  readonly objectKind: AccessObjectKind;
  readonly objectId: string;
  readonly organizationId: string;
  readonly epoch: number;
  readonly manifestHash: string;
  readonly updatedAt: Date;
}

interface StoredAccessEventDependencyProjection {
  readonly eventHash: string;
  readonly objectKind: AccessObjectKind;
  readonly objectId: string;
  readonly dependencyManifestHash: string;
  readonly dependencyIndex: number;
}

interface StoredAccessManifestPrincipalHeadProjection
  extends ReferencedPrincipalHead {
  readonly manifestHash: string;
  readonly objectKind: AccessObjectKind;
  readonly objectId: string;
}

interface StoredAccessManifestDocumentLinkProjection {
  readonly manifestHash: string;
  readonly documentId: string;
  readonly containerId: string;
}

interface StoreVerifiedAccessManifestInput {
  readonly verifiedManifest: AnyVerifiedAccessManifest;
}

interface StoredAccessManifestBundle {
  readonly event: VerifiedAccessEvent;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly state: KeyingCanonicalJson;
}

function accessEventDependencyHashes(event: VerifiedAccessEvent): string[] {
  return [...event.event.dependencyManifestHashes];
}

function accessManifestReferencedHeads(
  manifest: AnyVerifiedAccessManifest,
): ReferencedPrincipalHead[] {
  return manifest.manifest.referencedPrincipalHeads.map((principalHead) => ({
    ...principalHead,
  }));
}

function containerDirectGrantsCanonicalJson(
  directGrants: ContainerAccessManifestState["directGrants"],
): KeyingCanonicalJson {
  return directGrants.map((grant) => ({
    accessLevel: grant.accessLevel,
    subjectId: grant.subjectId,
    subjectType: grant.subjectType,
  }));
}

function containerAccessManifestStateCanonicalJson(
  state: ContainerAccessManifestState,
): KeyingCanonicalJson {
  return {
    version: state.version,
    containerId: state.containerId,
    organizationId: state.organizationId,
    epoch: state.epoch,
    previousManifestHash: state.previousManifestHash,
    eventHash: state.eventHash,
    parentContainerId: state.parentContainerId,
    parentManifestHash: state.parentManifestHash,
    metadataDocumentId: state.metadataDocumentId,
    containerKeyEpochId: state.containerKeyEpochId,
    directGrants: containerDirectGrantsCanonicalJson(state.directGrants),
    referencedPrincipalHeads: referencedPrincipalHeadsCanonicalJson(
      state.referencedPrincipalHeads,
    ),
  };
}

function documentLinkSetStateCanonicalJson(
  state: DocumentLinkSetManifestState,
): KeyingCanonicalJson {
  return {
    version: state.version,
    documentId: state.documentId,
    organizationId: state.organizationId,
    epoch: state.epoch,
    previousManifestHash: state.previousManifestHash,
    eventHash: state.eventHash,
    linkedContainerIds: [...state.linkedContainerIds],
  };
}

function unrecognizedAccessManifestState(state: never): never {
  throw new Error(`Unrecognized access manifest state: ${String(state)}`);
}

function accessManifestState(
  manifest: AnyVerifiedAccessManifest,
): KeyingCanonicalJson {
  if (!("state" in manifest)) {
    return {};
  }

  const { state } = manifest;
  if ("containerId" in state) {
    return containerAccessManifestStateCanonicalJson(state);
  }

  if ("documentId" in state) {
    return documentLinkSetStateCanonicalJson(state);
  }

  return unrecognizedAccessManifestState(state);
}

function documentLinkSetState(
  manifest: AnyVerifiedAccessManifest,
): VerifiedDocumentLinkSetManifest["state"] | null {
  if (manifest.manifest.objectKind !== "document" || !("state" in manifest)) {
    return null;
  }

  const { state } = manifest;
  if (
    !("documentId" in state) ||
    state.documentId !== manifest.manifest.objectId ||
    !Array.isArray(state.linkedContainerIds)
  ) {
    return null;
  }

  return state;
}

function referencedPrincipalHeadsCanonicalJson(
  principalHeads: readonly ReferencedPrincipalHead[],
): KeyingCanonicalJson {
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
  left: KeyingCanonicalJson,
  right: KeyingCanonicalJson,
): boolean {
  return (
    serializeKeyingCanonicalJson(left) === serializeKeyingCanonicalJson(right)
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

export async function storeVerifiedAccessEvent(
  verifiedEvent: VerifiedAccessEvent,
  executor: AccessManifestStoreExecutor = db,
): Promise<VerifiedAccessEvent> {
  if (executor === db) {
    return db.transaction((tx) => storeVerifiedAccessEvent(verifiedEvent, tx));
  }

  await insertAccessEvent(verifiedEvent, executor);
  return verifiedEvent;
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
  verifiedManifest: AnyVerifiedAccessManifest,
  executor: AccessManifestStoreExecutor,
): Promise<boolean> {
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
      state: accessManifestState(verifiedManifest),
    })
    .onConflictDoNothing({ target: accessManifests.manifestHash })
    .returning();

  if (!insertedManifest) {
    await ensureStoredAccessManifestMatches(verifiedManifest, executor);
    return false;
  }

  return true;
}

async function ensureStoredAccessManifestMatches(
  verifiedManifest: AnyVerifiedAccessManifest,
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
    storedManifest.keyTargetHash !== manifest.keyTargetHash ||
    !canonicalJsonMatches(
      storedManifest.state as KeyingCanonicalJson,
      accessManifestState(verifiedManifest),
    )
  ) {
    throw new Error("Access manifest conflict");
  }
}

function toStoredAccessEvent(
  row: typeof accessEvents.$inferSelect,
): VerifiedAccessEvent {
  return {
    event: {
      version: row.version as 1,
      eventId: row.eventId,
      eventType: row.eventType,
      objectKind: row.objectKind,
      objectId: row.objectId,
      organizationId: row.organizationId,
      previousManifestHash: row.previousManifestHash,
      dependencyManifestHashes: readJsonArray<string>(
        row.dependencyManifestHashes,
        "access event dependency hashes",
      ),
      bodyHash: row.bodyHash,
      signerUserId: row.signerUserId,
      signerDeviceId: row.signerDeviceId,
      signerKeyFingerprint: row.signerKeyFingerprint,
      signedAt: row.signedAt.toISOString(),
      signature: row.signature,
    },
    body: row.body as KeyingCanonicalJson,
    eventHash: row.eventHash,
  } as VerifiedAccessEvent;
}

function toStoredAccessManifest(
  row: typeof accessManifests.$inferSelect,
): AccessManifest {
  return {
    version: row.version as 1,
    objectKind: row.objectKind,
    objectId: row.objectId,
    organizationId: row.organizationId,
    epoch: row.epoch,
    previousManifestHash: row.previousManifestHash,
    eventHash: row.eventHash,
    structuralHash: row.structuralHash,
    grantRoot: row.grantRoot,
    referencedPrincipalHeads: readJsonArray<ReferencedPrincipalHead>(
      row.referencedPrincipalHeads,
      "access manifest referenced principal heads",
    ),
    keyTargetHash: row.keyTargetHash,
  };
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

export async function getAccessManifestBundle(
  manifestHash: string,
  executor: AccessManifestStoreExecutor = db,
): Promise<StoredAccessManifestBundle | null> {
  const [manifest] = await executor
    .select()
    .from(accessManifests)
    .where(eq(accessManifests.manifestHash, manifestHash))
    .limit(1);

  if (!manifest) {
    return null;
  }

  const event = await loadAccessEventRow(manifest.eventHash, executor);

  return {
    event: toStoredAccessEvent(event),
    manifest: toStoredAccessManifest(manifest),
    manifestHash: manifest.manifestHash,
    state: manifest.state as KeyingCanonicalJson,
  };
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

  const referencedPrincipalHeads = readJsonArray<ReferencedPrincipalHead>(
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

async function replaceAccessManifestDocumentLinkProjection(
  verifiedManifest: AnyVerifiedAccessManifest,
  executor: AccessManifestStoreExecutor,
): Promise<void> {
  const state = documentLinkSetState(verifiedManifest);
  if (!state) {
    return;
  }

  await executor
    .delete(accessManifestDocumentLinkProjection)
    .where(
      eq(
        accessManifestDocumentLinkProjection.manifestHash,
        verifiedManifest.manifestHash,
      ),
    );

  if (state.linkedContainerIds.length === 0) {
    return;
  }

  await executor.insert(accessManifestDocumentLinkProjection).values(
    state.linkedContainerIds.map((containerId) => ({
      manifestHash: verifiedManifest.manifestHash,
      documentId: state.documentId,
      containerId,
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
  objectKind: AccessObjectKind,
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
  verifiedManifest: AnyVerifiedAccessManifest,
  executor: AccessManifestStoreExecutor,
): Promise<StoredAccessManifestHead> {
  const manifest = verifiedManifest.manifest;

  const [advancedHead] = await executor
    .insert(accessManifestHeads)
    .values({
      objectKind: manifest.objectKind,
      objectId: manifest.objectId,
      organizationId: manifest.organizationId,
      epoch: manifest.epoch,
      manifestHash: verifiedManifest.manifestHash,
    })
    .onConflictDoUpdate({
      target: [accessManifestHeads.objectKind, accessManifestHeads.objectId],
      set: {
        organizationId: manifest.organizationId,
        epoch: manifest.epoch,
        manifestHash: verifiedManifest.manifestHash,
        updatedAt: new Date(),
      },
      setWhere: lt(accessManifestHeads.epoch, manifest.epoch),
    })
    .returning();

  if (advancedHead) {
    return toStoredAccessManifestHead(advancedHead);
  }

  const currentHead = await loadCurrentAccessManifestHead(
    manifest.objectKind,
    manifest.objectId,
    executor,
  );

  if (!currentHead) {
    throw new Error("Failed to load stored access manifest head");
  }

  if (
    manifest.epoch === currentHead.epoch &&
    verifiedManifest.manifestHash !== currentHead.manifestHash
  ) {
    throw new Error("Access manifest head epoch conflict");
  }

  return currentHead;
}

export async function storeVerifiedAccessManifest(
  input: StoreVerifiedAccessManifestInput,
  executor: AccessManifestStoreExecutor = db,
): Promise<StoredAccessManifestHead> {
  if (executor === db) {
    return db.transaction(async (tx) => storeVerifiedAccessManifest(input, tx));
  }

  await insertAccessEvent(input.verifiedManifest.event, executor);
  const manifestInserted = await insertAccessManifest(
    input.verifiedManifest,
    executor,
  );
  if (manifestInserted) {
    await regenerateAccessManifestProjections(
      input.verifiedManifest.manifestHash,
      executor,
    );
  }
  // Link-set membership is verifier state, so refresh it from the branded
  // manifest rather than trying to infer it from generic manifest rows.
  await replaceAccessManifestDocumentLinkProjection(
    input.verifiedManifest,
    executor,
  );

  return advanceAccessManifestHead(input.verifiedManifest, executor);
}

export async function getCurrentAccessManifestHead(
  objectKind: AccessObjectKind,
  objectId: string,
  executor: AccessManifestStoreExecutor = db,
): Promise<StoredAccessManifestHead | null> {
  return loadCurrentAccessManifestHead(objectKind, objectId, executor);
}

export async function getCurrentAccessManifestHeads(
  objectKind: AccessObjectKind,
  objectIds: readonly string[],
  executor: AccessManifestStoreExecutor = db,
): Promise<Map<string, StoredAccessManifestHead>> {
  const uniqueObjectIds = [...new Set(objectIds)].sort();

  if (uniqueObjectIds.length === 0) {
    return new Map();
  }

  const heads = await executor
    .select()
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, objectKind),
        inArray(accessManifestHeads.objectId, uniqueObjectIds),
      ),
    );

  return new Map(
    heads.map((head) => [head.objectId, toStoredAccessManifestHead(head)]),
  );
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

export async function listAccessManifestDocumentLinkProjection(
  manifestHash: string,
  executor: AccessManifestStoreExecutor = db,
): Promise<StoredAccessManifestDocumentLinkProjection[]> {
  return executor
    .select({
      manifestHash: accessManifestDocumentLinkProjection.manifestHash,
      documentId: accessManifestDocumentLinkProjection.documentId,
      containerId: accessManifestDocumentLinkProjection.containerId,
    })
    .from(accessManifestDocumentLinkProjection)
    .where(eq(accessManifestDocumentLinkProjection.manifestHash, manifestHash))
    .orderBy(asc(accessManifestDocumentLinkProjection.containerId));
}

export async function listAccessManifestDocumentLinkProjections(
  manifestHashes: readonly string[],
  executor: AccessManifestStoreExecutor = db,
): Promise<StoredAccessManifestDocumentLinkProjection[]> {
  const uniqueManifestHashes = [...new Set(manifestHashes)].sort();

  if (uniqueManifestHashes.length === 0) {
    return [];
  }

  return executor
    .select({
      manifestHash: accessManifestDocumentLinkProjection.manifestHash,
      documentId: accessManifestDocumentLinkProjection.documentId,
      containerId: accessManifestDocumentLinkProjection.containerId,
    })
    .from(accessManifestDocumentLinkProjection)
    .where(
      inArray(
        accessManifestDocumentLinkProjection.manifestHash,
        uniqueManifestHashes,
      ),
    )
    .orderBy(
      asc(accessManifestDocumentLinkProjection.manifestHash),
      asc(accessManifestDocumentLinkProjection.containerId),
    );
}
