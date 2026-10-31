import type {
  HeldProjectionCitation,
  VerifiedManifestCitations,
  WriterProjectionTarget,
} from "@tearleads/api-client";
import { toFingerprint } from "@tearleads/crypto";
import {
  type AccessManifestBundleWireResponse,
  isAccessManifestBundleWireResponse,
} from "@tearleads/validators/response";
import { KNOWN_MANIFEST_HINT_LIMIT } from "@tearleads/validators/util";
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import {
  containerTables,
  documentContainerProjectionTables,
} from "../sqlite/schema";
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
import {
  type CitedObject,
  citedObjects,
  targetOrganization,
} from "./verifiedCitations/citationScope";
import {
  KEK_LEVEL_OBJECT_KIND,
  kekLevelRow,
  readStoredKekLevel,
  type VerifiedKekLevel,
} from "./verifiedCitations/kekLevelCitations";

/**
 * Bounds local bytes (a bundle is ~10–20 KB). Evicting the least recently
 * verified rows only makes a later read carry those bundles again.
 */
export const MAX_VERIFIED_MANIFEST_BUNDLES = 1024;
const STATEMENT_BATCH = 200;

interface VerifiedBundle {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly checkpoint: {
    readonly objectKind: string;
    readonly organizationId: string;
    readonly objectId: string;
    readonly epoch: number;
  };
}

/** Bytes a projection verification accepted: a bundle or a KEK level. */
export type VerifiedManifestBundle = VerifiedBundle | VerifiedKekLevel;

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
 * Prepares rows for bundles and KEK levels that just passed projection
 * verification. The digests are computed here, before the checkpoint
 * transaction that writes them begins.
 */
export async function verifiedManifestBundleRows(
  entries: readonly VerifiedManifestBundle[],
): Promise<VerifiedManifestBundleRow[]> {
  const bundleEntries: VerifiedBundle[] = [];
  const levelEntries: VerifiedKekLevel[] = [];
  for (const entry of entries)
    if ("kekLevel" in entry) levelEntries.push(entry);
    else bundleEntries.push(entry);
  // One level per container: its newest epoch, the last one seen on a tie.
  const levelRows = new Map<string, VerifiedManifestBundleRow>();
  for (const level of levelEntries) {
    const row = await kekLevelRow(level);
    const held = row && levelRows.get(row.objectId);
    if (row && (!held || held.epoch <= row.epoch))
      levelRows.set(row.objectId, row);
  }
  return [...(await bundleRows(bundleEntries)), ...levelRows.values()];
}

function bundleRows(
  entries: readonly VerifiedBundle[],
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
  await dropSupersededKekLevels(tx, rows);
  await pruneInTransaction(tx);
}

/**
 * A container keeps only its latest verified level: the API serves its
 * current level, so an older one can never be cited usefully again.
 */
async function dropSupersededKekLevels(
  tx: ClientSQLiteTransactionScope,
  rows: readonly VerifiedManifestBundleRow[],
): Promise<void> {
  const levels = rows.filter((row) => row.objectKind === KEK_LEVEL_OBJECT_KIND);
  for (const batch of batches(levels))
    await tx
      .delete(bundles)
      .where(
        and(
          eq(bundles.objectKind, KEK_LEVEL_OBJECT_KIND),
          inArray(
            bundles.objectId,
            batch.map((row) => row.objectId),
          ),
          notInArray(
            bundles.manifestHash,
            batch.map((row) => row.manifestHash),
          ),
        ),
      )
      .run();
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
  object: CitedObject,
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
    .where(
      and(
        eq(bundles.organizationId, organizationId),
        ne(bundles.objectKind, KEK_LEVEL_OBJECT_KIND),
      ),
    )
    .orderBy(desc(bundles.verifiedAt), asc(bundles.manifestHash))
    .limit(limit);
}

/** The latest verified KEK level of each container, in lineage order. */
async function lineageKekLevels(
  db: ClientSQLiteDatabase,
  organizationId: string,
  objects: readonly CitedObject[],
): Promise<StoredBundleRow[]> {
  const containerIds = objects
    .filter((object) => object.kind === "container")
    .map((object) => object.id);
  if (containerIds.length === 0) return [];
  const rows = await db
    .select({ ...storedColumns, objectId: bundles.objectId })
    .from(bundles)
    .where(
      and(
        eq(bundles.organizationId, organizationId),
        eq(bundles.objectKind, KEK_LEVEL_OBJECT_KIND),
        inArray(bundles.objectId, containerIds),
      ),
    )
    .orderBy(desc(bundles.epoch), desc(bundles.verifiedAt));
  const latest = new Map<string, StoredBundleRow>();
  for (const row of rows)
    if (!latest.has(row.objectId)) latest.set(row.objectId, row);
  return containerIds.flatMap((id) => latest.get(id) ?? []);
}

/**
 * The latest verified KEK level of each container the target's projection
 * walks; then verified bundles of those objects, newest epochs first; then
 * the most recently verified bundles of its organization, since a
 * just-verified parent is the likeliest part of a new child's projection.
 * Citations never leave the target's organization: an object whose
 * organization the device cannot place cites nothing. Damaged rows are
 * dropped.
 */
export async function loadVerifiedManifestCitations(
  execSql: ExecSql,
  target: WriterProjectionTarget,
  limit = KNOWN_MANIFEST_HINT_LIMIT,
): Promise<HeldProjectionCitation[]> {
  await ensureSqlTables(execSql, [
    ...verifiedManifestBundleTables,
    ...containerTables,
    ...documentContainerProjectionTables,
  ]);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const cited = new Map<string, HeldProjectionCitation>();
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
  for (const row of await lineageKekLevels(db, organizationId, objects)) {
    if (cited.size >= limit) break;
    const level = await readStoredKekLevel(row);
    if (level) cited.set(row.manifestHash, level);
    else damaged.push(row.manifestHash);
  }
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
