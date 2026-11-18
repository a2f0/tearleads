import type { SyncWatermark } from "@tearleads/validators/response";

/** Select the server's publication-based recovery contract during rollout.
 * Continuation positions inside the token remain opaque to the device. */
export function isPublicationWatermark(
  watermark: SyncWatermark | null | undefined,
): boolean {
  return watermark?.id.startsWith("d1/") === true;
}
