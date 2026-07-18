export const ORGANIZATION_READ_MODEL_PROTOCOL_VERSION = 4 as const;

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
