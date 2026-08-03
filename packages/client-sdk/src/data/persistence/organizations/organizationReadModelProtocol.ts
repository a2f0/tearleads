/**
 * Wire version of the organization read-model feed.
 *
 * Bumped 4 -> 5 when group members lost `memberPrincipalType`/`memberPrincipalId`
 * for a plain `userId`. The lane payload changed shape without changing its
 * field count or nesting, so a client left on 4 would not fail to parse it — it
 * would read every member as having no id. The version is what makes that
 * mismatch loud: the response assertion rejects any version it does not know,
 * and a cursor minted under the old version no longer validates, so the client
 * falls back to a full snapshot instead of applying deltas onto stale rows.
 */
export const ORGANIZATION_READ_MODEL_PROTOCOL_VERSION = 5 as const;

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
