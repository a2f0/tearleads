import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
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
  "root.reports.opsHealth.get",
] as const;

/** The server's own vocabulary: exactly the actions it records. */
export const RootAuditActionSchema = z.literal(ROOT_AUDIT_ACTIONS);

export type RootAuditAction = z.infer<typeof RootAuditActionSchema>;

/**
 * An action as the audit listing reports it. Every new root operation adds an
 * action, so clients accept any operation id rather than a closed list that a
 * newer server would outgrow; the known ones are listed as extensible.
 */
const RootAuditEventActionSchema = registerJsonSchemaFragment(
  z.string().min(1),
  {
    type: "string",
    minLength: 1,
    "x-extensible-enum": [...ROOT_AUDIT_ACTIONS],
  },
);

/** One recorded operator action, from `GET /root/audit-events`. */
export const RootAuditEventResponseSchema = loosePlainObject({
  action: RootAuditEventActionSchema,
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
