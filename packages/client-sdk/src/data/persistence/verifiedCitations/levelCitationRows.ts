import type { WriterProjectionTarget } from "@tearleads/api-client";
import { compareCanonicalStrings } from "@tearleads/crypto";
import { and, desc, eq, exists, inArray, ne } from "drizzle-orm";
import {
  LOCAL_INTENT_LANES,
  localIntents,
} from "../../sqlite/schema/localIntentSchema";
import { verifiedAccessManifestBundles as bundles } from "../../sqlite/schema/verifiedManifestBundleSchema";
import type { ClientSQLiteDatabase } from "../../sqlite/sqlitePersistenceRuntime";
import { type StoredBundleRow, storedColumns } from "./bundleCitationRows";
import type { CitedObject } from "./citationScope";
import { KEK_LEVEL_OBJECT_KIND } from "./kekLevelCitations";

/** Local placement is a hint, never authority for accepting a KEK level. */
async function levelHashes(
  db: ClientSQLiteDatabase,
  organizationId: string,
  objects: readonly CitedObject[],
  target: WriterProjectionTarget,
) {
  const pendingMove = db
    .select({ id: localIntents.id })
    .from(localIntents)
    .where(
      and(
        eq(
          localIntents.lane,
          target.kind === "container"
            ? LOCAL_INTENT_LANES.containerMove
            : LOCAL_INTENT_LANES.documentPlacement,
        ),
        eq(localIntents.subjectId, target.id),
        eq(localIntents.intentType, `${target.kind}.move`),
        ne(localIntents.syncStatus, "synced"),
      ),
    );
  // The cache is bounded to 1,024 rows. Read only narrow metadata here, not
  // every level's JSON or an IN list for every linked container.
  const rows = await db
    .select({
      manifestHash: bundles.manifestHash,
      objectId: bundles.objectId,
      verifiedAt: bundles.verifiedAt,
      pendingMove: exists(pendingMove).mapWith(Boolean),
    })
    .from(bundles)
    .where(
      and(
        eq(bundles.organizationId, organizationId),
        eq(bundles.objectKind, KEK_LEVEL_OBJECT_KIND),
      ),
    )
    .orderBy(desc(bundles.epoch), desc(bundles.verifiedAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows)
    if (!latest.has(row.objectId)) latest.set(row.objectId, row);
  const containerIds = objects
    .filter((object) => object.kind === "container")
    .map((object) => object.id);
  const lineage = containerIds.flatMap((id) => latest.get(id) ?? []);
  if (lineage.length > 0 && !rows[0]?.pendingMove)
    return lineage.map((row) => row.manifestHash);
  const ids = new Set(containerIds);
  const recent = [...latest.values()]
    .filter((row) => !ids.has(row.objectId))
    .sort(
      (a, b) =>
        compareCanonicalStrings(b.verifiedAt, a.verifiedAt) ||
        compareCanonicalStrings(a.manifestHash, b.manifestHash),
    );
  return [...lineage, ...recent].map((row) => row.manifestHash);
}

/** Load only the remaining quota, continuing past damage without wide JSON reads. */
export async function* lineageKekLevels(
  db: ClientSQLiteDatabase,
  organizationId: string,
  objects: readonly CitedObject[],
  target: WriterProjectionTarget,
  remaining: () => number,
): AsyncGenerator<StoredBundleRow> {
  const hashes = await levelHashes(db, organizationId, objects, target);
  let offset = 0;
  while (offset < hashes.length && remaining() > 0) {
    const batch = hashes.slice(offset, offset + remaining());
    offset += batch.length;
    const rows = await db
      .select(storedColumns)
      .from(bundles)
      .where(
        and(
          eq(bundles.organizationId, organizationId),
          inArray(bundles.manifestHash, batch),
        ),
      );
    const byHash = new Map(rows.map((row) => [row.manifestHash, row]));
    for (const hash of batch) {
      const row = byHash.get(hash);
      if (row) yield row;
    }
  }
}
