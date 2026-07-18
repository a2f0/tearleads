import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasStringProperty,
} from "../util";

/**
 * How the billing webhook dispositioned a lifecycle event: `applied` events
 * changed the organization's billing; `ignored` events were recorded only
 * (unhandled type, stale delivery, non-admin buyer, ...).
 */
export type OrganizationBillingHistoryOutcome = "applied" | "ignored";

/**
 * One provider billing lifecycle event in an organization's history, newest
 * first. `occurredAt` is the provider-reported event time as an ISO string.
 * There are no amounts: sync billing history records lifecycle transitions,
 * not charges.
 */
export interface OrganizationBillingHistoryEntry {
  eventType: string;
  outcome: OrganizationBillingHistoryOutcome;
  occurredAt: string;
  productId: string | null;
  transactionId: string | null;
}

export interface OrganizationBillingHistoryResponse {
  organizationId: string;
  entries: OrganizationBillingHistoryEntry[];
}

function isOrganizationBillingHistoryOutcome(
  value: unknown,
): value is OrganizationBillingHistoryOutcome {
  return value === "applied" || value === "ignored";
}

export function isOrganizationBillingHistoryEntry(
  value: unknown,
): value is OrganizationBillingHistoryEntry {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "eventType") &&
    hasStringProperty(value, "outcome") &&
    isOrganizationBillingHistoryOutcome(value.outcome) &&
    hasStringProperty(value, "occurredAt") &&
    hasNullableStringProperty(value, "productId") &&
    hasNullableStringProperty(value, "transactionId")
  );
}

export function isOrganizationBillingHistoryResponse(
  value: unknown,
): value is OrganizationBillingHistoryResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "organizationId") &&
    hasArrayProperty(value, "entries") &&
    value.entries.every(isOrganizationBillingHistoryEntry)
  );
}
