import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessManifests } from "@tearleads/api-shared/schema";
import type { AccessObjectKind } from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import { loadAccessManifestBundles } from "./accessManifestStore";

/**
 * Every retained manifest of one object, with its event, in one query instead
 * of two queries per manifest. Callers still verify what they use.
 */
export async function getObjectAccessManifestBundles(
  objectKind: AccessObjectKind,
  objectId: string,
  executor: DatabaseSession,
): ReturnType<typeof loadAccessManifestBundles> {
  return loadAccessManifestBundles(
    executor,
    and(
      eq(accessManifests.objectKind, objectKind),
      eq(accessManifests.objectId, objectId),
    ),
  );
}
