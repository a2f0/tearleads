import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestHeads,
  accessManifests,
  containers,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { StoredAccessManifestBundle } from "./accessManifestBundleCache";
import { toStoredAccessManifestBundle } from "./accessManifestBundleReads";

/** Missing or unreadable bundles remain for the individual walk to refuse. */
export async function getContainerPathRowsWithBundles(
  executor: DatabaseSession,
  containerIds: readonly string[],
) {
  const rows = await executor
    .select({
      container: {
        id: containers.id,
        organizationId: containers.organizationId,
        parentId: containers.parentId,
      },
      manifest: accessManifests,
      event: accessEvents,
    })
    .from(containers)
    .leftJoin(
      accessManifestHeads,
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(accessManifestHeads.objectId, containers.id),
      ),
    )
    .leftJoin(
      accessManifests,
      eq(accessManifests.manifestHash, accessManifestHeads.manifestHash),
    )
    .leftJoin(
      accessEvents,
      eq(accessEvents.eventHash, accessManifests.eventHash),
    )
    .where(inArray(containers.id, containerIds));
  return rows.map(({ container, manifest, event }) => {
    let bundle: StoredAccessManifestBundle | null = null;
    try {
      if (manifest?.objectKind === "container")
        bundle = toStoredAccessManifestBundle(manifest, event);
    } catch {
      // Preserve the walk's error ordering and per-container failure mapping.
    }
    return { container, bundle };
  });
}
