import type { SyncWatermark } from "@tearleads/validators/response";

/** Select the server's publication-based recovery contract during rollout.
 * Continuation positions inside the token remain opaque to the device. */
export function isPublicationWatermark(
  watermark: SyncWatermark | null | undefined,
): boolean {
  return watermark?.id.startsWith("d1/") === true;
}

/** An initial legacy cursor can replay on the upgraded API. Once a page has
 * been read, both sides of the continuation must use the same ordering. */
export function changesDiscoveryOrder(
  previous: SyncWatermark | null | undefined,
  next: SyncWatermark | null,
  isContinuation: boolean,
): boolean {
  if (!previous || !next) return false;
  return isPublicationWatermark(previous)
    ? !isPublicationWatermark(next)
    : isContinuation && isPublicationWatermark(next);
}
