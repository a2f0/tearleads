import { db } from "@tearleads/api-shared/postgres";
import { accessManifestVerifications } from "@tearleads/api-shared/schema";

/**
 * Model a deployment whose verification markers are gone (a rotated secret or
 * verifier version): the next read verifies retained history in full.
 */
export async function clearAccessManifestVerificationMarkers(): Promise<void> {
  await db.delete(accessManifestVerifications);
}
