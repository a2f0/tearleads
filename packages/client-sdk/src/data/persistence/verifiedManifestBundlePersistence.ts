import type {
  HeldDirectoryCitation,
  HeldProjectionCitation,
  VerifiedManifestCitations,
  WriterProjectionTarget,
} from "@tearleads/api-client";
import { toFingerprint } from "@tearleads/crypto";
import {
  KNOWN_MANIFEST_HINT_LIMIT,
  type ServedAccessManifestBundleWireResponse,
} from "@tearleads/validators/util";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { containerTables, localIntentTables } from "../sqlite/schema";
import {
  documentContainerProjectionTables,
  documentProjectionTables,
} from "../sqlite/schema/documentProjectionSchema";
import {
  verifiedAccessManifestBundles as bundles,
  verifiedManifestBundleTables,
} from "../sqlite/schema/verifiedManifestBundleSchema";
import { sqliteInsertBatchSize } from "../sqlite/sqliteBindBudget";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../sqlite/sqlitePersistenceRuntime";
import { excludedValue } from "../sqlite/sqliteUpsert";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";
import { collectVerifiedManifestCitations } from "./verifiedCitations/citationCollection";
import {
  citedObjects,
  targetOrganization,
} from "./verifiedCitations/citationScope";
import {
  KEK_LEVEL_OBJECT_KIND,
  kekLevelRow,
  type VerifiedKekLevel,
} from "./verifiedCitations/kekLevelCitations";

/**
 * Bounds local bytes (a bundle is ~10–20 KB). Evicting the least recently
 * verified rows only makes a later read carry those bundles again.
 */
export const MAX_VERIFIED_MANIFEST_BUNDLES = 1024;
const STATEMENT_BATCH = 200;

interface VerifiedBundle {
  /** The served bytes; the decoded state is rebuilt from them on refill. */
  readonly bundle: ServedAccessManifestBundleWireResponse;
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
  const stored = await touchStoredDigests(
    tx,
    rows.map((row) => row.manifestHash),
    verifiedAt,
  );
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
  // All incremental SDK level writes pass here. Both checkpoint callers
  // prepare them with verifiedManifestBundleRows (one level per container),
  // then write and drop siblings in the same serialized transaction. Thus an
  // unchanged level already removed its siblings; eviction/reset only delete.
  // Restored caches must preserve that invariant too: this fast path does not
  // repair externally injected stale siblings.
  await dropSupersededKekLevels(tx, [...changed.values()]);
  // Replacing or touching existing rows cannot grow the bounded cache.
  if (rows.some((row) => !stored.has(row.manifestHash))) {
    await pruneInTransaction(tx);
  }
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

async function touchStoredDigests(
  tx: ClientSQLiteTransactionScope,
  manifestHashes: readonly string[],
  verifiedAt: string,
): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  for (const batch of batches(manifestHashes)) {
    const rows = await tx
      .update(bundles)
      .set({ verifiedAt })
      .where(inArray(bundles.manifestHash, batch))
      .returning({
        bundleDigest: bundles.bundleDigest,
        manifestHash: bundles.manifestHash,
      });
    for (const row of rows) digests.set(row.manifestHash, row.bundleDigest);
  }
  return digests;
}

/**
 * The latest verified KEK level of each container the target's projection
 * walks (supplemented by organization-recency levels for a pending move,
 * or when the lineage has no stored level); then verified bundles of those
 * objects, newest epochs first; then
 * the most recently verified bundles of its organization, since a
 * just-verified parent is the likeliest part of a new child's projection.
 * Citations never leave the target's organization: an object whose
 * organization the device cannot place cites nothing. Damaged rows are
 * dropped.
 */
/**
 * The organization directory payloads a device holds, from the subsystem
 * that stores policy bundles; the composition root wires it.
 */
export type HeldDirectorySource = (
  execSql: ExecSql,
  organizationId: string,
) => Promise<readonly HeldDirectoryCitation[]>;

/**
 * The directory read's own budget, from the start of the citation load.
 * Directory citations are an extra: once manifest citations are collected,
 * the load waits for directories only until this much time has passed since
 * it began, and not at all after that, so a slow directory read never pushes
 * the load past the time the manifest collection alone took (or this budget)
 * and never spends the shared citation deadline on the manifest hints.
 */
const DIRECTORY_CITATION_BUDGET_MS = 50;

function directoriesWithinBudget(
  pending: Promise<readonly HeldDirectoryCitation[]>,
  startedAt: number,
): Promise<readonly HeldDirectoryCitation[]> {
  const remaining =
    startedAt + DIRECTORY_CITATION_BUDGET_MS - performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<readonly HeldDirectoryCitation[]>((resolve) => {
    timer = setTimeout(() => resolve([]), Math.max(0, remaining));
  });
  return Promise.race([pending, budget]).finally(() => clearTimeout(timer));
}

export async function loadVerifiedManifestCitations(
  execSql: ExecSql,
  target: WriterProjectionTarget,
  requestedLimit = KNOWN_MANIFEST_HINT_LIMIT,
  heldDirectories?: HeldDirectorySource,
): Promise<HeldProjectionCitation[]> {
  const limit = Math.min(KNOWN_MANIFEST_HINT_LIMIT, Math.floor(requestedLimit));
  if (!(limit > 0)) return [];
  const loadGeneration = evictionGeneration;
  citationLoadsInFlight += 1;
  try {
    return await loadCitableManifestCitations(
      execSql,
      target,
      limit,
      heldDirectories,
    ).then((cited) =>
      cited.filter((citation) => citable(citation, loadGeneration)),
    );
  } finally {
    citationLoadsInFlight -= 1;
    if (citationLoadsInFlight === 0) evictedInGeneration.clear();
  }
}

async function loadCitableManifestCitations(
  execSql: ExecSql,
  target: WriterProjectionTarget,
  limit: number,
  heldDirectories: HeldDirectorySource | undefined,
): Promise<HeldProjectionCitation[]> {
  await ensureSqlTables(execSql, [
    ...verifiedManifestBundleTables,
    ...containerTables,
    ...documentContainerProjectionTables,
    ...documentProjectionTables,
    ...localIntentTables,
  ]);
  const startedAt = performance.now();
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const objects = await citedObjects(db, target);
  const organizationId = await targetOrganization(db, target, objects);
  if (organizationId === null) return [];
  // Read held directories beside the manifest collection; they are cited
  // beside the manifest quota, never in its place.
  const directories = (
    heldDirectories?.(execSql, organizationId) ?? Promise.resolve([])
  ).catch(() => []);
  const { cited, damaged } = await collectVerifiedManifestCitations(
    db,
    organizationId,
    objects,
    target,
    limit,
  );
  if (damaged.length > 0)
    await dropVerifiedManifestBundles(execSql, damaged).catch(() => undefined);
  return [...cited, ...(await directoriesWithinBudget(directories, startedAt))];
}

// Manifest hashes whose held rows a refused read is dropping: no read cites
// them meanwhile, so none can be rebuilt from the bytes being dropped. Each
// eviction also advances a generation, so a citation load that started
// before it never returns the rows it read: they may already be gone.
const suppressedCitations = new Map<string, number>();
const evictedInGeneration = new Map<string, number>();
let evictionGeneration = 0;
// Loads in flight; once none overlap, the eviction log has nothing to guard.
let citationLoadsInFlight = 0;

/** Keeps these held bundles out of citations until the release runs. */
export function suppressHeldCitations(
  manifestHashes: readonly string[],
): () => void {
  evictionGeneration += 1;
  for (const hash of manifestHashes) {
    suppressedCitations.set(hash, (suppressedCitations.get(hash) ?? 0) + 1);
    evictedInGeneration.set(hash, evictionGeneration);
  }
  return () => {
    // The drop is complete: a load that started before now may hold the
    // dropped bytes, so it is newer than none of them.
    evictionGeneration += 1;
    for (const hash of manifestHashes) {
      evictedInGeneration.set(hash, evictionGeneration);
      const count = (suppressedCitations.get(hash) ?? 1) - 1;
      if (count > 0) suppressedCitations.set(hash, count);
      else suppressedCitations.delete(hash);
    }
  };
}

function citable(
  citation: HeldProjectionCitation,
  loadGeneration: number,
): boolean {
  if (!("manifestHash" in citation)) return true;
  const { manifestHash } = citation;
  return (
    !suppressedCitations.has(manifestHash) &&
    (evictedInGeneration.get(manifestHash) ?? 0) <= loadGeneration
  );
}

/**
 * Drops the stored rows of held bundles a projection that cited them failed
 * to verify with, so the next read fetches them from the server. Only a row
 * still holding the exact bytes cited goes, so a newer verified copy written
 * meanwhile stays; nothing is dropped once `stillCurrent` turns false.
 * Resolves whether the drop committed.
 */
export async function dropHeldManifestBundles(
  execSql: ExecSql,
  heldBundles: readonly ServedAccessManifestBundleWireResponse[],
  stillCurrent?: () => boolean,
): Promise<boolean> {
  if (heldBundles.length === 0) return true;
  const cited = await Promise.all(
    heldBundles.map(async (bundle) => ({
      manifestHash: bundle.manifestHash,
      bundleDigest: await sha256Hex(JSON.stringify(bundle)),
    })),
  );
  await ensureSqlTables(execSql, verifiedManifestBundleTables);
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const drop = async (tx: ClientSQLiteTransactionScope) => {
    for (const row of cited)
      await tx
        .delete(bundles)
        .where(
          and(
            eq(bundles.manifestHash, row.manifestHash),
            eq(bundles.bundleDigest, row.bundleDigest),
          ),
        )
        .run();
  };
  if (!stillCurrent) {
    await runtime.transaction(drop, { behavior: "immediate" });
    return true;
  }
  const { committed } = await runtime.guardedTransaction(drop, stillCurrent, {
    behavior: "immediate",
  });
  return committed;
}

/** Drops damaged stored rows so no later read cites them. */
async function dropVerifiedManifestBundles(
  execSql: ExecSql,
  manifestHashes: readonly string[],
): Promise<void> {
  if (manifestHashes.length === 0) return;
  await ensureSqlTables(execSql, verifiedManifestBundleTables);
  await getClientSQLitePersistenceRuntime(execSql).runMutation(
    async (handle) => {
      for (const batch of batches([...new Set(manifestHashes)]))
        await handle
          .delete(bundles)
          .where(inArray(bundles.manifestHash, batch))
          .run();
    },
  );
}

/** Cites from whichever database the signed-in identity currently uses. */
export function createVerifiedManifestCitations(
  resolveExecSql: () => ExecSql | null,
  heldDirectories?: HeldDirectorySource,
): VerifiedManifestCitations {
  return {
    cite: async (target) => {
      const execSql = resolveExecSql();
      return execSql
        ? loadVerifiedManifestCitations(
            execSql,
            target,
            KNOWN_MANIFEST_HINT_LIMIT,
            heldDirectories,
          )
        : [];
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
