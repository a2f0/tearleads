import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { verifiedAccessManifestBundles as bundles } from "../../sqlite/schema/verifiedManifestBundleSchema";
import type { ClientSQLiteDatabase } from "../../sqlite/sqlitePersistenceRuntime";
import type { CitedObject } from "./citationScope";

export interface StoredBundleRow {
  readonly bundleDigest: string;
  readonly bundleJson: string;
  readonly manifestHash: string;
}

export const storedColumns = {
  bundleDigest: bundles.bundleDigest,
  bundleJson: bundles.bundleJson,
  manifestHash: bundles.manifestHash,
};

export function objectRows(
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

/** Select narrow metadata first, then only the JSON the old object loop chose. */
export async function batchedObjectRows(
  db: ClientSQLiteDatabase,
  organizationId: string,
  objects: readonly CitedObject[],
  limit: number,
  read: (
    row: StoredBundleRow,
  ) => Promise<AccessManifestBundleWireResponse | null>,
): Promise<StoredBundleRow[] | null> {
  const byObject = new Map<string, string[]>();
  // Document placements can span many independent lineages. Bound the IN
  // lists even though each individual lineage is already depth-bounded.
  for (let offset = 0; offset < objects.length; offset += 200) {
    const batch = objects.slice(offset, offset + 200);
    const rows = await db
      .select({
        manifestHash: bundles.manifestHash,
        objectKind: bundles.objectKind,
        objectId: bundles.objectId,
      })
      .from(bundles)
      .where(
        and(
          eq(bundles.organizationId, organizationId),
          or(
            and(
              eq(bundles.objectKind, "container"),
              inArray(
                bundles.objectId,
                batch.filter((o) => o.kind === "container").map((o) => o.id),
              ),
            ),
            and(
              eq(bundles.objectKind, "document"),
              inArray(
                bundles.objectId,
                batch.filter((o) => o.kind === "document").map((o) => o.id),
              ),
            ),
          ),
        ),
      )
      .orderBy(desc(bundles.epoch));
    for (const row of rows) {
      const key = `${row.objectKind}:${row.objectId}`;
      const hashes = byObject.get(key) ?? [];
      hashes.push(row.manifestHash);
      byObject.set(key, hashes);
    }
  }
  const selected = objects
    .flatMap((object) => byObject.get(`${object.kind}:${object.id}`) ?? [])
    .slice(0, limit);
  if (selected.length === 0) return [];
  const rows = await db
    .select(storedColumns)
    .from(bundles)
    .where(
      and(
        eq(bundles.organizationId, organizationId),
        inArray(bundles.manifestHash, selected),
      ),
    );
  const byHash = new Map(rows.map((row) => [row.manifestHash, row]));
  const ordered: StoredBundleRow[] = [];
  for (const hash of selected) {
    const row = byHash.get(hash);
    // Damage (or eviction between the two reads) changes the remaining quota
    // of subsequent objects. Replay the old loop instead of guessing it.
    if (!row || !(await read(row))) return null;
    ordered.push(row);
  }
  return ordered;
}
