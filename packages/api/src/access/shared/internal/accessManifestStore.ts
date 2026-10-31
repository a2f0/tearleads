import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
} from "@tearleads/api-shared/schema";
import type {
  AccessManifest,
  AccessObjectKind,
  AnyVerifiedAccessManifest,
  KeyingCanonicalJson,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
} from "@tearleads/crypto";
import { readKeyingCanonicalJson } from "@tearleads/crypto";
import { and, asc, eq, inArray, lt, type SQL } from "drizzle-orm";
import { uniqueSortedStrings as unique } from "../../../utils/array";
import { canonicalJsonEquals } from "../../../utils/canonicalJson";
import { isSqliteApiDatabase } from "../../../utils/sqlDialect";
import { toStoredAccessEvent } from "./accessEventLookup";
import { insertAccessEvent } from "./accessEventStore";
import {
  accessManifestReferencedHeads,
  accessManifestState,
  isReferencedPrincipalHead,
  readAccessVersion,
  readJsonArray,
  referencedPrincipalHeadsCanonicalJson,
} from "./accessManifestJson";
import {
  insertAccessManifestPrincipalProjection,
  regenerateAccessManifestContainerGrantProjection,
  regenerateAccessManifestPrincipalProjection,
  replaceAccessManifestContainerGrantProjection,
  replaceAccessManifestDocumentLinkProjection,
} from "./accessManifestProjections";
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
  /** Untrusted stored-history marker; honored only after its MAC verifies. */
  readonly verificationMac: string | null;
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

export async function storeVerifiedAccessEventInTransaction(
  verifiedEvent: VerifiedAccessEvent,
  tx: DatabaseTransaction,
): Promise<VerifiedAccessEvent> {
  await insertAccessEvent(verifiedEvent, tx);
  return verifiedEvent;
}

/** The inserted row, or null when the same manifest was already stored. */
async function insertAccessManifest(
  verifiedManifest: AnyVerifiedAccessManifest,
  executor: DatabaseSession,
): Promise<typeof accessManifests.$inferSelect | null> {
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
    return null;
  }

  return insertedManifest;
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

export async function getAccessManifestBundle(
  manifestHash: string,
  executor: DatabaseSession,
): Promise<StoredAccessManifestBundle | null> {
  const bundles = await getAccessManifestBundles([manifestHash], executor);
  return bundles.get(manifestHash) ?? null;
}

export async function getAccessManifestBundles(
  manifestHashes: readonly string[],
  executor: DatabaseSession,
  omitUnreadable = false,
): Promise<Map<string, StoredAccessManifestBundle>> {
  const uniqueManifestHashes = unique(manifestHashes);
  if (uniqueManifestHashes.length === 0) {
    return new Map<string, StoredAccessManifestBundle>();
  }

  return loadAccessManifestBundles(
    executor,
    inArray(accessManifests.manifestHash, uniqueManifestHashes),
    omitUnreadable,
  );
}

/**
 * Manifests matching `where`, with their events. Both hashes are unique, so
 * the join cannot multiply rows. Keep missing events visible: an incomplete
 * bundle is corruption, not an absent manifest.
 */
export async function loadAccessManifestBundles(
  executor: DatabaseSession,
  where: SQL | undefined,
  omitUnreadable = false,
): Promise<Map<string, StoredAccessManifestBundle>> {
  const rows = await executor
    .select({ manifest: accessManifests, event: accessEvents })
    .from(accessManifests)
    .leftJoin(
      accessEvents,
      eq(accessEvents.eventHash, accessManifests.eventHash),
    )
    .where(where);
  const bundles = new Map<string, StoredAccessManifestBundle>();
  for (const { manifest, event } of rows) {
    try {
      if (!event) throw new Error("Access event not found");
      bundles.set(manifest.manifestHash, {
        event: toStoredAccessEvent(event),
        manifest: toStoredAccessManifest(manifest),
        manifestHash: manifest.manifestHash,
        state: readKeyingCanonicalJson(
          manifest.state,
          "stored access manifest state",
        ),
        verificationMac: manifest.verificationMac,
      });
    } catch (error) {
      if (!omitUnreadable) throw error;
    }
  }

  return bundles;
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
  const insertedManifest = await insertAccessManifest(
    input.verifiedManifest,
    tx,
  );
  // A newly inserted hash has no projection rows: every path that deletes a
  // manifest deletes its projections in the same transaction. Only a replay
  // of a stored manifest replaces them.
  const freshManifest = insertedManifest !== null;
  if (insertedManifest) {
    await insertAccessManifestPrincipalProjection(insertedManifest, tx);
  }
  // Link-set membership and direct grants are verifier state, so write them
  // from the branded manifest rather than inferring them from generic rows.
  await replaceAccessManifestDocumentLinkProjection(
    input.verifiedManifest,
    tx,
    freshManifest,
  );
  await replaceAccessManifestContainerGrantProjection(
    input.verifiedManifest,
    tx,
    freshManifest,
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

/** A document's current head and its link projection rows, in one read. */
export async function getCurrentDocumentHeadWithLinks(
  documentId: string,
  executor: DatabaseSession,
): Promise<{
  readonly head: StoredAccessManifestHead;
  readonly links: StoredAccessManifestDocumentLinkProjection[];
} | null> {
  const rows = await executor
    .select({
      head: accessManifestHeads,
      link: {
        manifestHash: accessManifestDocumentLinkProjection.manifestHash,
        documentId: accessManifestDocumentLinkProjection.documentId,
        containerId: accessManifestDocumentLinkProjection.containerId,
      },
    })
    .from(accessManifestHeads)
    .leftJoin(
      accessManifestDocumentLinkProjection,
      eq(
        accessManifestDocumentLinkProjection.manifestHash,
        accessManifestHeads.manifestHash,
      ),
    )
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.objectId, documentId),
      ),
    )
    .orderBy(asc(accessManifestDocumentLinkProjection.containerId));
  const [first] = rows;
  if (!first) return null;
  return {
    head: toStoredAccessManifestHead(first.head),
    links: rows.flatMap(({ link }) => (link ? [link] : [])),
  };
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
