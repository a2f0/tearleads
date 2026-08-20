/**
 * Wire version of the organization read-model feed.
 *
 * Bumped 5 -> 6 when container grant subjects lost the `organization` variant.
 * The version makes that flag-day wire change loud: the response assertion
 * rejects any version it does not know, and a cursor minted under the old
 * version no longer validates, so the client falls back to a full snapshot
 * instead of applying deltas onto stale rows.
 */
export const ORGANIZATION_READ_MODEL_PROTOCOL_VERSION = 6 as const;

/**
 * A stored projection row failed load-time validation. The projection is a
 * server-refetchable presentation cache, so loaders purge it and reconcile a
 * fresh snapshot instead of failing every read until a protocol bump.
 */
export class OrganizationReadModelIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationReadModelIntegrityError";
  }
}
