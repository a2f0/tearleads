import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessManifests } from "@tearleads/api-shared/schema";
import type { AccessObjectKind } from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import { getAccessManifestBundles } from "./accessManifestStore";

type ManifestBundlesByHash = Awaited<
  ReturnType<typeof getAccessManifestBundles>
>;

// Keeps each IN list well inside every supported dialect's bind limit.
const HISTORY_BATCH_SIZE = 500;

/**
 * Every retained manifest of one object, loaded in a few batched queries
 * instead of two queries per manifest. Callers still verify what they use.
 */
export async function getObjectAccessManifestBundles(
  objectKind: AccessObjectKind,
  objectId: string,
  executor: DatabaseSession,
): Promise<ManifestBundlesByHash> {
  const rows = await executor
    .select({ manifestHash: accessManifests.manifestHash })
    .from(accessManifests)
    .where(
      and(
        eq(accessManifests.objectKind, objectKind),
        eq(accessManifests.objectId, objectId),
      ),
    );
  const bundles: ManifestBundlesByHash = new Map();
  for (let offset = 0; offset < rows.length; offset += HISTORY_BATCH_SIZE) {
    const batch = await getAccessManifestBundles(
      rows
        .slice(offset, offset + HISTORY_BATCH_SIZE)
        .map(({ manifestHash }) => manifestHash),
      executor,
    );
    for (const [manifestHash, bundle] of batch)
      bundles.set(manifestHash, bundle);
  }
  return bundles;
}
