import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import {
  accessEventDependencyProjection,
  accessEvents,
  accessManifestContainerGrantProjection,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
} from "@symcrypt/api-shared/schema";
import type {
  AccessManifest,
  AccessObjectKind,
  AnyVerifiedAccessManifest,
  ContainerAccessManifestState,
  KeyingCanonicalJson,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
} from "@symcrypt/crypto";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { uniqueSortedStrings as unique } from "../../../utils/array";
import {
  canonicalJsonEquals,
  readKeyingCanonicalJson,
} from "../../../utils/canonicalJson";
import { isSqliteApiDatabase } from "../../../utils/sqlDialect";
import { toStoredAccessEvent } from "./accessEventLookup";
import {
  accessEventDependencyHashes,
  accessManifestReferencedHeads,
  accessManifestState,
  containerManifestState,
  documentLinkSetState,
  isContainerDirectGrant,
  isReferencedPrincipalHead,
  isString,
  readAccessVersion,
  readJsonArray,
  referencedPrincipalHeadsCanonicalJson,
} from "./accessManifestJson";
import { selectOneOrThrow } from "./selectOneOrThrow";

/**
 * access projection tables are derived cache only.
 *
 * Callers must verify signed access events and manifests with the crypto
 * package before trusting any row returned here for authorization decisions.
 */

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
  executor: DatabaseSession,
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

export async function storeVerifiedAccessEventInTransaction(
  verifiedEvent: VerifiedAccessEvent,
  tx: DatabaseTransaction,
): Promise<VerifiedAccessEvent> {
  await insertAccessEvent(verifiedEvent, tx);
  const storedEvent = await loadAccessEventRow(verifiedEvent.eventHash, tx);
  await regenerateAccessEventDependencyProjection(storedEvent, tx);
  return verifiedEvent;
}

async function ensureStoredAccessEventMatches(
  verifiedEvent: VerifiedAccessEvent,
  executor: DatabaseSession,
): Promise<void> {
  const storedEvent = await selectOneOrThrow(
    executor
      .select()
      .from(accessEvents)
      .where(eq(accessEvents.eventHash, verifiedEvent.eventHash))
      .limit(1),
    "Failed to load stored access event",
  );

  const event = verifiedEvent.event;
  if (
    storedEvent.version !== event.version ||
    storedEvent.eventId !== event.eventId ||
    storedEvent.eventType !== event.eventType ||
    storedEvent.objectKind !== event.objectKind ||
    storedEvent.objectId !== event.objectId ||
    storedEvent.organizationId !== event.organizationId ||
    storedEvent.previousManifestHash !== event.previousManifestHash ||
    !canonicalJsonEquals(
      storedEvent.dependencyManifestHashes,
      accessEventDependencyHashes(verifiedEvent),
    ) ||
    storedEvent.bodyHash !== event.bodyHash ||
    !canonicalJsonEquals(storedEvent.body, verifiedEvent.body) ||
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
  executor: DatabaseSession,
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
  executor: DatabaseSession,
): Promise<void> {
  const storedManifest = await selectOneOrThrow(
    executor
      .select()
      .from(accessManifests)
      .where(eq(accessManifests.manifestHash, verifiedManifest.manifestHash))
      .limit(1),
    "Failed to load stored access manifest",
  );

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
    !canonicalJsonEquals(
      referencedPrincipalHeadsCanonicalJson(
        storedManifest.referencedPrincipalHeads,
      ),
      referencedPrincipalHeadsCanonicalJson(
        accessManifestReferencedHeads(verifiedManifest),
      ),
    ) ||
    storedManifest.keyTargetHash !== manifest.keyTargetHash ||
    !canonicalJsonEquals(
      storedManifest.state,
      accessManifestState(verifiedManifest),
    )
  ) {
    throw new Error("Access manifest conflict");
  }
}

function toStoredAccessManifest(
  row: typeof accessManifests.$inferSelect,
): AccessManifest {
  return {
    version: readAccessVersion(row.version, "stored access manifest"),
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
      isReferencedPrincipalHead,
    ),
    keyTargetHash: row.keyTargetHash,
  };
}

async function loadAccessManifestRow(
  manifestHash: string,
  executor: DatabaseSession,
): Promise<typeof accessManifests.$inferSelect> {
  return selectOneOrThrow(
    executor
      .select()
      .from(accessManifests)
      .where(eq(accessManifests.manifestHash, manifestHash))
      .limit(1),
    "Access manifest not found",
  );
}

async function loadAccessEventRow(
  eventHash: string,
  executor: DatabaseSession,
): Promise<typeof accessEvents.$inferSelect> {
  return selectOneOrThrow(
    executor
      .select()
      .from(accessEvents)
      .where(eq(accessEvents.eventHash, eventHash))
      .limit(1),
    "Access event not found",
  );
}

export async function getAccessManifestBundle(
  manifestHash: string,
  executor: DatabaseSession,
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
    state: readKeyingCanonicalJson(
      manifest.state,
      "stored access manifest state",
    ),
  };
}

export async function getAccessManifestBundles(
  manifestHashes: readonly string[],
  executor: DatabaseSession,
): Promise<Map<string, StoredAccessManifestBundle>> {
  const uniqueManifestHashes = unique(manifestHashes);
  if (uniqueManifestHashes.length === 0) {
    return new Map<string, StoredAccessManifestBundle>();
  }

  const manifests = await executor
    .select()
    .from(accessManifests)
    .where(inArray(accessManifests.manifestHash, uniqueManifestHashes));
  if (manifests.length === 0) {
    return new Map<string, StoredAccessManifestBundle>();
  }

  const events = await executor
    .select()
    .from(accessEvents)
    .where(
      inArray(
        accessEvents.eventHash,
        unique(manifests.map(({ eventHash }) => eventHash)),
      ),
    );
  const eventByHash = new Map(events.map((event) => [event.eventHash, event]));
  const bundles = new Map<string, StoredAccessManifestBundle>();
  for (const manifest of manifests) {
    const event = eventByHash.get(manifest.eventHash);
    if (!event) {
      throw new Error("Access event not found");
    }

    bundles.set(manifest.manifestHash, {
      event: toStoredAccessEvent(event),
      manifest: toStoredAccessManifest(manifest),
      manifestHash: manifest.manifestHash,
      state: readKeyingCanonicalJson(
        manifest.state,
        "stored access manifest state",
      ),
    });
  }

  return bundles;
}

async function regenerateAccessEventDependencyProjection(
  event: typeof accessEvents.$inferSelect,
  executor: DatabaseSession,
): Promise<void> {
  await executor
    .delete(accessEventDependencyProjection)
    .where(eq(accessEventDependencyProjection.eventHash, event.eventHash));

  const dependencyHashes = readJsonArray<string>(
    event.dependencyManifestHashes,
    "access event dependency projection source",
    isString,
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
  executor: DatabaseSession,
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
    isReferencedPrincipalHead,
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

async function regenerateAccessManifestContainerGrantProjection(
  manifest: typeof accessManifests.$inferSelect,
  executor: DatabaseSession,
): Promise<void> {
  await executor
    .delete(accessManifestContainerGrantProjection)
    .where(
      eq(
        accessManifestContainerGrantProjection.manifestHash,
        manifest.manifestHash,
      ),
    );

  if (manifest.objectKind !== "container") {
    return;
  }

  const state =
    typeof manifest.state === "object" && manifest.state !== null
      ? manifest.state
      : {};
  const directGrantValue = Reflect.get(state, "directGrants");
  if (directGrantValue === undefined) {
    return;
  }
  const directGrants = readJsonArray<
    ContainerAccessManifestState["directGrants"][number]
  >(
    directGrantValue,
    "access manifest container grant projection source",
    isContainerDirectGrant,
  );

  if (directGrants.length === 0) {
    return;
  }

  await executor.insert(accessManifestContainerGrantProjection).values(
    directGrants.map((grant) => ({
      manifestHash: manifest.manifestHash,
      containerId: manifest.objectId,
      accessLevel: grant.accessLevel,
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
    })),
  );
}

async function replaceAccessManifestDocumentLinkProjection(
  verifiedManifest: AnyVerifiedAccessManifest,
  executor: DatabaseSession,
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

async function replaceAccessManifestContainerGrantProjection(
  verifiedManifest: AnyVerifiedAccessManifest,
  executor: DatabaseSession,
): Promise<void> {
  const state = containerManifestState(verifiedManifest);
  if (!state) {
    return;
  }

  await executor
    .delete(accessManifestContainerGrantProjection)
    .where(
      eq(
        accessManifestContainerGrantProjection.manifestHash,
        verifiedManifest.manifestHash,
      ),
    );

  if (state.directGrants.length === 0) {
    return;
  }

  await executor.insert(accessManifestContainerGrantProjection).values(
    state.directGrants.map((grant) => ({
      manifestHash: verifiedManifest.manifestHash,
      containerId: state.containerId,
      accessLevel: grant.accessLevel,
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
    })),
  );
}

export async function regenerateAccessManifestProjections(
  manifestHash: string,
  database: ApiDatabase,
): Promise<void> {
  return database.transaction((tx) =>
    regenerateAccessManifestProjectionsInTransaction(manifestHash, tx),
  );
}

async function regenerateAccessManifestProjectionsInTransaction(
  manifestHash: string,
  tx: DatabaseTransaction,
): Promise<void> {
  const manifest = await loadAccessManifestRow(manifestHash, tx);
  const event = await loadAccessEventRow(manifest.eventHash, tx);

  await regenerateAccessEventDependencyProjection(event, tx);
  await regenerateAccessManifestPrincipalProjection(manifest, tx);
  await regenerateAccessManifestContainerGrantProjection(manifest, tx);
}

async function loadCurrentAccessManifestHead(
  objectKind: AccessObjectKind,
  objectId: string,
  executor: DatabaseSession,
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
  executor: DatabaseSession,
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
  database: ApiDatabase,
): Promise<StoredAccessManifestHead> {
  return database.transaction((tx) =>
    storeVerifiedAccessManifestInTransaction(input, tx),
  );
}

export async function storeVerifiedAccessManifestInTransaction(
  input: StoreVerifiedAccessManifestInput,
  tx: DatabaseTransaction,
): Promise<StoredAccessManifestHead> {
  await insertAccessEvent(input.verifiedManifest.event, tx);
  const manifestInserted = await insertAccessManifest(
    input.verifiedManifest,
    tx,
  );
  if (manifestInserted) {
    await regenerateAccessManifestProjectionsInTransaction(
      input.verifiedManifest.manifestHash,
      tx,
    );
  }
  // Link-set membership is verifier state, so refresh it from the branded
  // manifest rather than trying to infer it from generic manifest rows.
  await replaceAccessManifestDocumentLinkProjection(input.verifiedManifest, tx);
  await replaceAccessManifestContainerGrantProjection(
    input.verifiedManifest,
    tx,
  );

  return advanceAccessManifestHead(input.verifiedManifest, tx);
}

export async function getCurrentAccessManifestHead(
  objectKind: AccessObjectKind,
  objectId: string,
  executor: DatabaseSession,
): Promise<StoredAccessManifestHead | null> {
  return loadCurrentAccessManifestHead(objectKind, objectId, executor);
}

async function lockAccessManifestHeads(
  objectKind: AccessObjectKind,
  objectIds: readonly string[],
  executor: DatabaseSession,
  mode: "share" | "update",
): Promise<readonly string[]> {
  const uniqueObjectIds = unique(objectIds);
  if (uniqueObjectIds.length === 0) {
    return [];
  }

  const lockQuery = executor
    .select({ objectId: accessManifestHeads.objectId })
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, objectKind),
        inArray(accessManifestHeads.objectId, uniqueObjectIds),
      ),
    )
    // PostgreSQL does not preserve the input order of an IN predicate. Sort
    // the rows before FOR SHARE/UPDATE acquires locks so overlapping mutation
    // plans cannot take the same manifest heads in opposite orders.
    .orderBy(asc(accessManifestHeads.objectId));

  if (isSqliteApiDatabase()) {
    return (await lockQuery).map((head) => head.objectId);
  }

  return (await lockQuery.for(mode)).map((head) => head.objectId);
}

export async function lockAccessManifestHeadsForShare(
  objectKind: AccessObjectKind,
  objectIds: readonly string[],
  executor: DatabaseSession,
): Promise<readonly string[]> {
  return lockAccessManifestHeads(objectKind, objectIds, executor, "share");
}

export async function lockAccessManifestHeadsForUpdate(
  objectKind: AccessObjectKind,
  objectIds: readonly string[],
  executor: DatabaseSession,
): Promise<readonly string[]> {
  return lockAccessManifestHeads(objectKind, objectIds, executor, "update");
}

export async function getCurrentAccessManifestHeads(
  objectKind: AccessObjectKind,
  objectIds: readonly string[],
  executor: DatabaseSession,
): Promise<Map<string, StoredAccessManifestHead>> {
  const uniqueObjectIds = unique(objectIds);
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
  executor: DatabaseSession,
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
  executor: DatabaseSession,
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
  executor: DatabaseSession,
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
  executor: DatabaseSession,
): Promise<StoredAccessManifestDocumentLinkProjection[]> {
  const uniqueManifestHashes = unique(manifestHashes);

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
