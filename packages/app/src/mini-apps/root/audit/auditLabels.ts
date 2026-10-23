import type { RootAuditEvent } from "@tearleads/client-sdk";
import type { RootAuditAction } from "@tearleads/validators/response";

const ROOT_AUDIT_ACTION_LABELS: Record<RootAuditAction, string> = {
  "root.access.grant": "Granted root",
  "root.access.revoke": "Revoked root",
  "root.auditEvents.list": "Viewed audit trail",
  "root.identities.get": "Viewed identity",
  "root.identities.list": "Listed identities",
  "root.identities.organizations.list": "Viewed identity organizations",
  "root.identities.suspension.delete": "Requested suspension lift",
  "root.identities.suspension.put": "Requested account suspension",
  "root.organizations.dataUsage.get": "Viewed organization data usage",
  "root.organizations.get": "Viewed organization",
  "root.organizations.identities.list": "Viewed organization roster",
  "root.organizations.list": "Listed organizations",
  "root.organizations.revenuecatEvents.list":
    "Viewed organization RevenueCat webhooks",
  "root.reports.dataUsage.list": "Viewed data usage report",
  "root.reports.opsHealth.get": "Viewed operations health report",
  "root.reports.revenuecatEvents.list": "Viewed RevenueCat webhook report",
};

function isLabeledAction(action: string): action is RootAuditAction {
  return Object.hasOwn(ROOT_AUDIT_ACTION_LABELS, action);
}

/** A known action's label; an action newer than this console shows its id. */
export function rootAuditActionLabel(action: RootAuditEvent["action"]): string {
  return isLabeledAction(action) ? ROOT_AUDIT_ACTION_LABELS[action] : action;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Null when the draft is empty; undefined when it is not a full ID. */
export function parseAuditSubject(draft: string): string | null | undefined {
  const trimmed = draft.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  return UUID_PATTERN.test(trimmed) ? trimmed : undefined;
}
