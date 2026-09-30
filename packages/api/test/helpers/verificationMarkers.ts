import { db } from "@tearleads/api-shared/postgres";
import { accessManifestVerifications } from "@tearleads/api-shared/schema";
import { clearProcessVerificationMarkers } from "../../src/workflows/containers/writerProjection/verificationMarkers";

/**
 * Model a restarted deployment whose verification markers are gone (a rotated
 * secret or new rules): the next read verifies retained history in full.
 */
export async function clearAccessManifestVerificationMarkers(): Promise<void> {
  await db.delete(accessManifestVerifications);
  clearProcessVerificationMarkers();
}
