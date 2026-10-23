import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  sha256HexStringSchema,
} from "../schema";

/**
 * Every action the root audit trail records: one per `/root` operation, plus
 * the API CLI's root grant and revoke.
 */
export const ROOT_AUDIT_ACTIONS = [
  "root.access.grant",
  "root.access.revoke",
  "root.auditEvents.list",
  "root.identities.get",
  "root.identities.list",
  "root.identities.organizations.list",
  "root.organizations.dataUsage.get",
  "root.organizations.get",
  "root.organizations.identities.list",
  "root.organizations.list",
  "root.reports.dataUsage.list",
] as const;

export const RootAuditActionSchema = z.literal(ROOT_AUDIT_ACTIONS);

export type RootAuditAction = z.infer<typeof RootAuditActionSchema>;

/** One recorded operator action, from `GET /root/audit-events`. */
export const RootAuditEventResponseSchema = loosePlainObject({
  action: RootAuditActionSchema,
  /** The acting root identity's signing key; null when the API CLI acted. */
  actorSigningKeyFingerprint: sha256HexStringSchema.nullable(),
  actorUserId: nonEmptyStringSchema.nullable(),
  /** Listing filters as a sorted query string; null when none applied. */
  filter: z.string().nullable(),
  id: nonEmptyStringSchema,
  occurredAt: z.string(),
  sourceIpAddress: z.string().nullable(),
  targetOrganizationId: nonEmptyStringSchema.nullable(),
  targetUserId: nonEmptyStringSchema.nullable(),
});

export type RootAuditEventResponse = z.infer<
  typeof RootAuditEventResponseSchema
>;

export const RootAuditEventsResponseSchema = loosePlainObject({
  events: arraySchema(RootAuditEventResponseSchema),
  /** Opaque cursor for the next page; null when the listing is exhausted. */
  nextCursor: z.string().nullable(),
});

export type RootAuditEventsResponse = z.infer<
  typeof RootAuditEventsResponseSchema
>;
