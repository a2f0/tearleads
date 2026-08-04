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

/** The billing concern represented by one history entry. */
export type OrganizationBillingHistoryCategory =
  | "lifecycle"
  | "seat"
  | "invoice";

/** The system that supplied the durable history record. */
export type OrganizationBillingHistoryProvider =
  | "revenuecat"
  | "stripe"
  | "internal";

/**
 * One durable billing event in an organization's history, newest first.
 * Provider monetary values use the currency's minor unit exactly as reported.
 * A recognized native grant may instead expose its canonical monthly USD list
 * price through `unitAmount`; `totalAmount` remains null without a provider-paid
 * total. Nullable fields are explicit so every category has one stable shape.
 */
export interface OrganizationBillingHistoryEntry {
  id: string;
  category: OrganizationBillingHistoryCategory;
  provider: OrganizationBillingHistoryProvider;
  eventType: string;
  outcome: OrganizationBillingHistoryOutcome;
  occurredAt: string;
  productId: string | null;
  transactionId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
  billingReason: string | null;
  seatCount: number | null;
  seatDelta: number | null;
  activeSeatCount: number | null;
  priceId: string | null;
  unitAmount: number | null;
  currency: string | null;
  interval: string | null;
  intervalCount: number | null;
  totalAmount: number | null;
  periodStartsAt: string | null;
  periodEndsAt: string | null;
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

function isOrganizationBillingHistoryCategory(
  value: unknown,
): value is OrganizationBillingHistoryCategory {
  return value === "lifecycle" || value === "seat" || value === "invoice";
}

function isOrganizationBillingHistoryProvider(
  value: unknown,
): value is OrganizationBillingHistoryProvider {
  return value === "revenuecat" || value === "stripe" || value === "internal";
}

function hasNullableSafeIntegerProperty(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const property = value[key];
  return (
    property === null ||
    (typeof property === "number" && Number.isSafeInteger(property))
  );
}

function hasNullableNonNegativeSafeIntegerProperty(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const property = value[key];
  return (
    property === null ||
    (typeof property === "number" &&
      Number.isSafeInteger(property) &&
      property >= 0)
  );
}

function hasNullablePositiveSafeIntegerProperty(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const property = value[key];
  return (
    property === null ||
    (typeof property === "number" &&
      Number.isSafeInteger(property) &&
      property > 0)
  );
}

export function isOrganizationBillingHistoryEntry(
  value: unknown,
): value is OrganizationBillingHistoryEntry {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "category") &&
    isOrganizationBillingHistoryCategory(value.category) &&
    hasStringProperty(value, "provider") &&
    isOrganizationBillingHistoryProvider(value.provider) &&
    hasStringProperty(value, "eventType") &&
    hasStringProperty(value, "outcome") &&
    isOrganizationBillingHistoryOutcome(value.outcome) &&
    hasStringProperty(value, "occurredAt") &&
    hasNullableStringProperty(value, "productId") &&
    hasNullableStringProperty(value, "transactionId") &&
    hasNullableStringProperty(value, "invoiceId") &&
    hasNullableStringProperty(value, "subscriptionId") &&
    hasNullableStringProperty(value, "billingReason") &&
    hasNullableNonNegativeSafeIntegerProperty(value, "seatCount") &&
    hasNullableSafeIntegerProperty(value, "seatDelta") &&
    hasNullableNonNegativeSafeIntegerProperty(value, "activeSeatCount") &&
    hasNullableStringProperty(value, "priceId") &&
    hasNullableNonNegativeSafeIntegerProperty(value, "unitAmount") &&
    hasNullableStringProperty(value, "currency") &&
    hasNullableStringProperty(value, "interval") &&
    hasNullablePositiveSafeIntegerProperty(value, "intervalCount") &&
    hasNullableNonNegativeSafeIntegerProperty(value, "totalAmount") &&
    hasNullableStringProperty(value, "periodStartsAt") &&
    hasNullableStringProperty(value, "periodEndsAt")
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
