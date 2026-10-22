import { index, pgTable, text, timestamp, uuid } from "./columns";

/**
 * Every action a root audit row can record. The API's response contract lists
 * the same values, and the API checks at compile time that the two agree.
 */
export type RootAuditAction =
  | "root.access.grant"
  | "root.access.revoke"
  | "root.auditEvents.list"
  | "root.identities.get"
  | "root.identities.list"
  | "root.identities.organizations.list"
  | "root.organizations.dataUsage.get"
  | "root.organizations.get"
  | "root.organizations.identities.list"
  | "root.organizations.list"
  | "root.reports.dataUsage.list";

/**
 * Every platform-operator action, in the order it happened.
 *
 * The `/root` routes record one row before they read or change anything, and
 * a request whose row cannot be written is refused, so no operator lookup goes
 * unrecorded. The API CLI records each change to `users.is_root` here too.
 * Rows are platform records, not organization data: an organization purge
 * leaves them in place.
 *
 * Columns:
 * - `actorUserId`: The root identity that made the request, or null when the
 *   API CLI acted with database credentials.
 * - `action`: What was done — a root operation id such as
 *   `root.identities.get`, or `root.access.grant` / `root.access.revoke`.
 * - `targetUserId` / `targetOrganizationId`: The identity or organization the
 *   action was about, when it named one.
 * - `filter`: The listing filters the operator applied, as a sorted query
 *   string (`fingerprint=…`, `search=…`); paging cursors are not recorded.
 * - `sourceIpAddress`: The operator's request IP, when one was resolved.
 * - `occurredAt`: When the action was recorded.
 *
 * Indexes:
 * - `root_audit_events_occurred_at_id_idx` backs the newest-first listing.
 * - The actor, target-user, and target-organization indexes back the listing
 *   filtered to one identity or organization.
 */
export const rootAuditEvents = pgTable(
  "root_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").$type<RootAuditAction>().notNull(),
    targetUserId: uuid("target_user_id"),
    targetOrganizationId: uuid("target_organization_id"),
    filter: text("filter"),
    sourceIpAddress: text("source_ip_address"),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  },
  (table) => [
    index("root_audit_events_occurred_at_id_idx").on(
      table.occurredAt,
      table.id,
    ),
    index("root_audit_events_actor_idx").on(
      table.actorUserId,
      table.occurredAt,
      table.id,
    ),
    index("root_audit_events_target_user_idx").on(
      table.targetUserId,
      table.occurredAt,
      table.id,
    ),
    index("root_audit_events_target_organization_idx").on(
      table.targetOrganizationId,
      table.occurredAt,
      table.id,
    ),
  ],
);
