import type {
  VerifiedManifestCitations,
  WriterProjectionTarget,
} from "@tearleads/api-client";
import { toFingerprint } from "@tearleads/crypto";
import {
  type AccessManifestBundleWireResponse,
  isAccessManifestBundleWireResponse,
} from "@tearleads/validators/response";
import {
  KNOWN_MANIFEST_HINT_LIMIT,
  MAX_CONTAINER_PATH_LENGTH,
} from "@tearleads/validators/util";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  containerTables,
  documentContainerProjection,
  documentContainerProjectionTables,
} from "../sqlite/schema";
import { containers } from "../sqlite/schema/containerSchema";
import {
  documentDiscoveryHeads,
  pendingDocumentDiscoveries,
} from "../sqlite/schema/documentDiscoveryEvidenceSchema";
import {
  verifiedAccessManifestBundles as bundles,
  verifiedManifestBundleTables,
} from "../sqlite/schema/verifiedManifestBundleSchema";
import { sqliteInsertBatchSize } from "../sqlite/sqliteBindBudget";
import {
  type ClientSQLiteDatabase,
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../sqlite/sqlitePersistenceRuntime";
import { excludedValue } from "../sqlite/sqliteUpsert";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

/**
 * Bounds local bytes (a bundle is ~10–20 KB). Evicting the least recently
 * verified rows only makes a later read carry those bundles again.
 */
export const MAX_VERIFIED_MANIFEST_BUNDLES = 1024;
const STATEMENT_BATCH = 200;

export interface VerifiedManifestBundle {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly checkpoint: {
    readonly objectKind: string;
    readonly organizationId: string;
    readonly objectId: string;
    readonly epoch: number;
  };
}

function sha256Hex(text: string): Promise<string> {
  return toFingerprint(new TextEncoder().encode(text));
}

const BUNDLE_WRITE_BATCH_SIZE = sqliteInsertBatchSize(bundles);

function slices<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

function batches<T>(values: readonly T[]): T[][] {
  return slices(values, STATEMENT_BATCH);
}

async function pruneInTransaction(
  tx: ClientSQLiteTransactionScope,
): Promise<void> {
  const [row] = await tx.select({ count: sql<number>`count(*)` }).from(bundles);
  const excess = (row?.count ?? 0) - MAX_VERIFIED_MANIFEST_BUNDLES;
  if (excess <= 0) return;
  const evicted = await tx
    .select({ manifestHash: bundles.manifestHash })
    .from(bundles)
    .orderBy(asc(bundles.verifiedAt), asc(bundles.manifestHash))
    .limit(excess);
  for (const batch of batches(evicted.map((entry) => entry.manifestHash)))
    await tx.delete(bundles).where(inArray(bundles.manifestHash, batch)).run();
}

/** A verified bundle's exact JSON and that JSON's digest. */
export type VerifiedManifestBundleRow = Omit<
  typeof bundles.$inferInsert,
  "verifiedAt"
>;

/**
 * Prepares rows for bundles that just passed projection verification. The
 * digests are computed here, before the checkpoint transaction that writes
 * them begins.
 */
export function verifiedManifestBundleRows(
  entries: readonly VerifiedManifestBundle[],
): Promise<VerifiedManifestBundleRow[]> {
  const unique = new Map(
    entries.map((entry) => [entry.bundle.manifestHash, entry]),
  );
  return Promise.all(
    [...unique.values()].map(async ({ bundle, checkpoint }) => {
      const bundleJson = JSON.stringify(bundle);
      return {
        manifestHash: bundle.manifestHash,
        organizationId: checkpoint.organizationId,
        objectKind: checkpoint.objectKind,
        objectId: checkpoint.objectId,
        epoch: checkpoint.epoch,
        bundleJson,
        bundleDigest: await sha256Hex(bundleJson),
      };
    }),
  );
}

/**
 * Records verified bundles inside the transaction that finalizes their
 * projection's checkpoints, so they commit or roll back with it and no cache
 * work outlives the verification. Freshly verified bytes replace any stored
 * copy.
 */
export async function writeVerifiedManifestBundlesInTransaction(
  tx: ClientSQLiteTransactionScope,
  rows: readonly VerifiedManifestBundleRow[],
  verifiedAt: string,
): Promise<void> {
  if (rows.length === 0) return;
  const stored = await storedDigests(
    tx,
    rows.map((row) => row.manifestHash),
  );
  // An identical stored row only needs its recency refreshed.
  const unchanged = rows.filter(
    (row) => stored.get(row.manifestHash) === row.bundleDigest,
  );
  for (const batch of batches(unchanged.map((row) => row.manifestHash)))
    await tx
      .update(bundles)
      .set({ verifiedAt })
      .where(inArray(bundles.manifestHash, batch))
      .run();
  // A repeated hash keeps its last changed row, as sequential upserts would.
  const changed = new Map(
    rows
      .filter((row) => stored.get(row.manifestHash) !== row.bundleDigest)
      .map((row) => [row.manifestHash, { ...row, verifiedAt }]),
  );
  for (const batch of slices([...changed.values()], BUNDLE_WRITE_BATCH_SIZE))
    await tx
      .insert(bundles)
      .values(batch)
      .onConflictDoUpdate({
        target: bundles.manifestHash,
        set: {
          organizationId: excludedValue(bundles.organizationId),
          objectKind: excludedValue(bundles.objectKind),
          objectId: excludedValue(bundles.objectId),
          epoch: excludedValue(bundles.epoch),
          bundleJson: excludedValue(bundles.bundleJson),
          bundleDigest: excludedValue(bundles.bundleDigest),
          verifiedAt: excludedValue(bundles.verifiedAt),
        },
      })
      .run();
  await pruneInTransaction(tx);
}

async function storedDigests(
  tx: ClientSQLiteTransactionScope,
  manifestHashes: readonly string[],
): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  for (const batch of batches(manifestHashes)) {
    const rows = await tx
      .select({
        bundleDigest: bundles.bundleDigest,
        manifestHash: bundles.manifestHash,
      })
      .from(bundles)
      .where(inArray(bundles.manifestHash, batch));
    for (const row of rows) digests.set(row.manifestHash, row.bundleDigest);
  }
  return digests;
}

/** The requested object first, then each container whose lineage it cites. */
async function containerLineage(
  db: ClientSQLiteDatabase,
  containerId: string,
): Promise<string[]> {
  const lineage = [containerId];
  while (lineage.length < MAX_CONTAINER_PATH_LENGTH) {
    const [row] = await db
      .select({ parentId: containers.parentId })
      .from(containers)
      .where(eq(containers.id, lineage.at(-1) ?? ""))
      .limit(1);
    const parentId = row?.parentId;
    if (!parentId || lineage.includes(parentId)) break;
    lineage.push(parentId);
  }
  return lineage;
}

async function citedObjects(
  db: ClientSQLiteDatabase,
  target: WriterProjectionTarget,
): Promise<{ readonly kind: string; readonly id: string }[]> {
  if (target.kind === "container")
    return (await containerLineage(db, target.id)).map((id) => ({
      kind: "container",
      id,
    }));
  // Linked containers, containers listing the document before its signed
  // placement is checked, and a container whose metadata document it is.
  const placements = [
    ...(await db
      .select({ containerId: documentContainerProjection.containerId })
      .from(documentContainerProjection)
      .where(eq(documentContainerProjection.documentId, target.id))),
    ...(await db
      .select({ containerId: pendingDocumentDiscoveries.containerId })
      .from(pendingDocumentDiscoveries)
      .where(eq(pendingDocumentDiscoveries.documentId, target.id))),
    ...(await db
      .select({ containerId: containers.id })
      .from(containers)
      .where(eq(containers.metadataDocumentId, target.id))),
  ];
  const containerIds = new Set<string>();
  for (const { containerId } of placements)
    if (containerId)
      for (const id of await containerLineage(db, containerId))
        containerIds.add(id);
  return [
    { kind: "document", id: target.id },
    ...[...containerIds].map((id) => ({ kind: "container", id })),
  ];
}

/**
 * The one organization every local source places the read in. Verified
 * ownership (stored verified bundles of the target and of the containers on
 * its walk, and a document's verified discovery head) and local placement
 * (listed container rows reached through links, pending listings, metadata,
 * or parents) must all agree: any disagreement, or no source at all, yields
 * null, so the read is sent with no hints rather than another
 * organization's.
 */
async function targetOrganization(
  db: ClientSQLiteDatabase,
  target: WriterProjectionTarget,
  objects: readonly { readonly kind: string; readonly id: string }[],
): Promise<string | null> {
  const containerIds = objects
    .filter((object) => object.kind === "container")
    .map((object) => object.id);
  const listed =
    containerIds.length === 0
      ? []
      : await db
          .select({ organizationId: containers.organizationId })
          .from(containers)
          .where(inArray(containers.id, containerIds));
  const verifiedContainers =
    containerIds.length === 0
      ? []
      : await db
          .select({ organizationId: bundles.organizationId })
          .from(bundles)
          .where(
            and(
              eq(bundles.objectKind, "container"),
              inArray(bundles.objectId, containerIds),
            ),
          );
  const verifiedTarget = await db
    .select({ organizationId: bundles.organizationId })
    .from(bundles)
    .where(
      and(eq(bundles.objectKind, target.kind), eq(bundles.objectId, target.id)),
    );
  const discovered =
    target.kind === "document"
      ? await db
          .select({ organizationId: documentDiscoveryHeads.organizationId })
          .from(documentDiscoveryHeads)
          .where(eq(documentDiscoveryHeads.documentId, target.id))
      : [];
  const sources = [listed, verifiedContainers, verifiedTarget, discovered];
  const organizations = new Set(
    sources.flat().map((row) => row.organizationId),
  );
  const [organizationId] = organizations;
  return organizations.size === 1 && organizationId ? organizationId : null;
}

interface StoredBundleRow {
  readonly bundleDigest: string;
  readonly bundleJson: string;
  readonly manifestHash: string;
}

const storedColumns = {
  bundleDigest: bundles.bundleDigest,
  bundleJson: bundles.bundleJson,
  manifestHash: bundles.manifestHash,
};

async function readStoredBundle(
  row: StoredBundleRow,
): Promise<AccessManifestBundleWireResponse | null> {
  if ((await sha256Hex(row.bundleJson)) !== row.bundleDigest) return null;
  try {
    const bundle: unknown = JSON.parse(row.bundleJson);
    return isAccessManifestBundleWireResponse(bundle) &&
      bundle.manifestHash === row.manifestHash
      ? bundle
      : null;
  } catch {
    return null;
  }
}

function objectRows(
  db: ClientSQLiteDatabase,
  organizationId: string,
  object: { readonly kind: string; readonly id: string },
  limit: number,
) {
  return db
    .select(storedColumns)
    .from(bundles)
    .where(
      and(
        eq(bundles.organizationId, organizationId),
        eq(bundles.objectKind, object.kind),
        eq(bundles.objectId, object.id),
      ),
    )
    .orderBy(desc(bundles.epoch))
    .limit(limit);
}

function recentRows(
  db: ClientSQLiteDatabase,
  organizationId: string,
  limit: number,
) {
  return db
    .select(storedColumns)
    .from(bundles)
    .where(eq(bundles.organizationId, organizationId))
    .orderBy(desc(bundles.verifiedAt), asc(bundles.manifestHash))
    .limit(limit);
}

/**
 * Verified bundles of the target's object and of the containers its
 * projection walks, newest epochs first; then the most recently verified rows
 * of its organization, since a just-verified parent is the likeliest part of
 * a new child's projection. Citations never leave the target's organization:
 * an object whose organization the device cannot place cites nothing.
 * Damaged rows are dropped.
 */
export async function loadVerifiedManifestCitations(
  execSql: ExecSql,
  target: WriterProjectionTarget,
  limit = KNOWN_MANIFEST_HINT_LIMIT,
): Promise<AccessManifestBundleWireResponse[]> {
  await ensureSqlTables(execSql, [
    ...verifiedManifestBundleTables,
    ...containerTables,
    ...documentContainerProjectionTables,
  ]);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const cited = new Map<string, AccessManifestBundleWireResponse>();
  const damaged: string[] = [];
  const collect = async (rows: readonly StoredBundleRow[]) => {
    for (const row of rows) {
      if (cited.size >= limit || cited.has(row.manifestHash)) continue;
      const bundle = await readStoredBundle(row);
      if (bundle) cited.set(row.manifestHash, bundle);
      else damaged.push(row.manifestHash);
    }
  };
  const objects = await citedObjects(db, target);
  const organizationId = await targetOrganization(db, target, objects);
  if (organizationId === null) return [];
  for (const object of objects)
    if (cited.size < limit)
      await collect(
        await objectRows(db, organizationId, object, limit - cited.size),
      );
  if (cited.size < limit)
    await collect(await recentRows(db, organizationId, limit + cited.size));
  if (damaged.length > 0)
    await getClientSQLitePersistenceRuntime(execSql)
      .runMutation((handle) =>
        handle
          .delete(bundles)
          .where(inArray(bundles.manifestHash, damaged))
          .run(),
      )
      .catch(() => undefined);
  return [...cited.values()];
}

/** Cites from whichever database the signed-in identity currently uses. */
export function createVerifiedManifestCitations(
  resolveExecSql: () => ExecSql | null,
): VerifiedManifestCitations {
  return {
    cite: async (target) => {
      const execSql = resolveExecSql();
      return execSql ? loadVerifiedManifestCitations(execSql, target) : [];
    },
  };
}

/** Drops an organization's verified bundles when a remote reset forgets it. */
export async function deleteVerifiedManifestBundlesForOrganization(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<void> {
  await tx
    .delete(bundles)
    .where(eq(bundles.organizationId, organizationId))
    .run();
}
