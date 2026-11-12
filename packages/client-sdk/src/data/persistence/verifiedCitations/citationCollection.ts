import type {
  HeldProjectionCitation,
  WriterProjectionTarget,
} from "@tearleads/api-client";
import { toFingerprint } from "@tearleads/crypto";
import {
  type AccessManifestBundleWireResponse,
  isAccessManifestBundleWireResponse,
} from "@tearleads/validators/response";
import { and, asc, desc, eq, ne, notInArray } from "drizzle-orm";
import { verifiedAccessManifestBundles as bundles } from "../../sqlite/schema/verifiedManifestBundleSchema";
import type { ClientSQLiteDatabase } from "../../sqlite/sqlitePersistenceRuntime";
import {
  batchedObjectRows,
  objectRows,
  type StoredBundleRow,
  storedColumns,
} from "./bundleCitationRows";
import type { CitedObject } from "./citationScope";
import { KEK_LEVEL_OBJECT_KIND, readStoredKekLevel } from "./kekLevelCitations";
import { lineageKekLevels } from "./levelCitationRows";

async function readStoredBundle(
  row: StoredBundleRow,
): Promise<AccessManifestBundleWireResponse | null> {
  if (
    (await toFingerprint(new TextEncoder().encode(row.bundleJson))) !==
    row.bundleDigest
  )
    return null;
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

function recentRows(
  db: ClientSQLiteDatabase,
  organizationId: string,
  limit: number,
  excluded: readonly string[] = [],
  offset = 0,
) {
  return db
    .select(storedColumns)
    .from(bundles)
    .where(
      and(
        eq(bundles.organizationId, organizationId),
        ne(bundles.objectKind, KEK_LEVEL_OBJECT_KIND),
        excluded.length > 0
          ? notInArray(bundles.manifestHash, [...excluded])
          : undefined,
      ),
    )
    .orderBy(desc(bundles.verifiedAt), asc(bundles.manifestHash))
    .limit(limit)
    .offset(offset);
}

function citationCollector(limit: number) {
  const cited = new Map<string, HeldProjectionCitation>();
  const damaged: string[] = [];
  return {
    cited,
    damaged,
    remaining: () => limit - cited.size,
    async collect(
      rows: readonly StoredBundleRow[],
      read: (
        row: StoredBundleRow,
      ) => Promise<HeldProjectionCitation | null> = readStoredBundle,
    ) {
      for (const row of rows) {
        if (cited.size >= limit || cited.has(row.manifestHash)) continue;
        const citation = await read(row);
        if (citation) cited.set(row.manifestHash, citation);
        else damaged.push(row.manifestHash);
      }
    },
  };
}

type CitationCollector = ReturnType<typeof citationCollector>;

async function collectObjects(
  db: ClientSQLiteDatabase,
  organizationId: string,
  objects: readonly CitedObject[],
  collector: CitationCollector,
) {
  if (collector.remaining() === 0) return;
  const rows =
    objects.length > 2
      ? await batchedObjectRows(
          db,
          organizationId,
          objects,
          collector.remaining(),
          readStoredBundle,
        )
      : null;
  if (rows) await collector.collect(rows);
  else
    for (const object of objects)
      if (collector.remaining() > 0)
        await collector.collect(
          await objectRows(db, organizationId, object, collector.remaining()),
        );
}

async function collectRecent(
  db: ClientSQLiteDatabase,
  organizationId: string,
  collector: CitationCollector,
  limit: number,
) {
  if (collector.remaining() === 0) return;
  const window = limit + collector.cited.size;
  const damageCount = collector.damaged.length;
  await collector.collect(
    await recentRows(db, organizationId, collector.remaining(), [
      ...collector.cited.keys(),
    ]),
  );
  // Damage can free quota. Replay the original recent window in bounded
  // pages; a healthy read never loads duplicate JSON.
  if (collector.damaged.length > damageCount)
    for (
      let offset = 0;
      offset < window && collector.remaining() > 0;
      offset += limit
    )
      await collector.collect(
        await recentRows(
          db,
          organizationId,
          Math.min(limit, window - offset),
          [],
          offset,
        ),
      );
}

/**
 * Healthy reads load at most the hint quota in JSON across all phases. Damage
 * may require more reads to preserve the old fallback, each bounded by that
 * quota; only accepted citations are retained. None are verifier trust input.
 */
export async function collectVerifiedManifestCitations(
  db: ClientSQLiteDatabase,
  organizationId: string,
  objects: readonly CitedObject[],
  target: WriterProjectionTarget,
  limit: number,
) {
  const collector = citationCollector(limit);
  for await (const row of lineageKekLevels(
    db,
    organizationId,
    objects,
    target,
    collector.remaining,
  ))
    await collector.collect([row], readStoredKekLevel);
  await collectObjects(db, organizationId, objects, collector);
  await collectRecent(db, organizationId, collector, limit);
  return { cited: [...collector.cited.values()], damaged: collector.damaged };
}
