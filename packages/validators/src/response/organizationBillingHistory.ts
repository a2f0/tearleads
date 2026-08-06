import { z } from "zod";
import {
  arraySchema,
  boundedPositiveIntegerSchema,
  loosePlainObject,
  safeIntegerSchema,
  safeNonNegativeIntegerSchema,
} from "../schema";

/**
 * How the billing webhook dispositioned a lifecycle event: `applied` events
 * changed the organization's billing; `ignored` events were recorded only
 * (unhandled type, stale delivery, non-admin buyer, ...).
 */
export const OrganizationBillingHistoryOutcomeSchema = z.literal([
  "applied",
  "ignored",
]);

export type OrganizationBillingHistoryOutcome = z.infer<
  typeof OrganizationBillingHistoryOutcomeSchema
>;

/** The billing concern represented by one history entry. */
export const OrganizationBillingHistoryCategorySchema = z.literal([
  "lifecycle",
  "seat",
  "invoice",
]);

export type OrganizationBillingHistoryCategory = z.infer<
  typeof OrganizationBillingHistoryCategorySchema
>;

/** The system that supplied the durable history record. */
export const OrganizationBillingHistoryProviderSchema = z.literal([
  "revenuecat",
  "stripe",
  "internal",
]);

export type OrganizationBillingHistoryProvider = z.infer<
  typeof OrganizationBillingHistoryProviderSchema
>;

/** RevenueCat billing environment associated with a lifecycle audit row. */
export const OrganizationBillingHistoryEnvironmentSchema = z.literal([
  "sandbox",
  "production",
]);

export type OrganizationBillingHistoryEnvironment = z.infer<
  typeof OrganizationBillingHistoryEnvironmentSchema
>;

const nullableStringSchema = z.string().nullable();
const nullableSafeNonNegativeIntegerSchema =
  safeNonNegativeIntegerSchema.nullable();

/**
 * One durable billing event in an organization's history, newest first.
 * Provider monetary values use the currency's minor unit exactly as reported.
 * A recognized native grant may instead expose its canonical monthly USD list
 * price through `unitAmount`; its purchased-currency transaction uses the
 * distinct `totalAmount` / `totalCurrency` pair. Nullable fields are explicit
 * so every category has one stable shape.
 */
export const OrganizationBillingHistoryEntrySchema = loosePlainObject({
  id: z.string(),
  category: OrganizationBillingHistoryCategorySchema,
  provider: OrganizationBillingHistoryProviderSchema,
  environment: OrganizationBillingHistoryEnvironmentSchema.nullable(),
  eventType: z.string(),
  outcome: OrganizationBillingHistoryOutcomeSchema,
  occurredAt: z.string(),
  productId: nullableStringSchema,
  transactionId: nullableStringSchema,
  invoiceId: nullableStringSchema,
  subscriptionId: nullableStringSchema,
  billingReason: nullableStringSchema,
  seatCount: nullableSafeNonNegativeIntegerSchema,
  seatDelta: safeIntegerSchema.nullable(),
  activeSeatCount: nullableSafeNonNegativeIntegerSchema,
  priceId: nullableStringSchema,
  unitAmount: nullableSafeNonNegativeIntegerSchema,
  currency: nullableStringSchema,
  interval: nullableStringSchema,
  intervalCount: boundedPositiveIntegerSchema(
    Number.MAX_SAFE_INTEGER,
  ).nullable(),
  totalAmount: nullableSafeNonNegativeIntegerSchema,
  totalCurrency: nullableStringSchema,
  periodStartsAt: nullableStringSchema,
  periodEndsAt: nullableStringSchema,
});

export type OrganizationBillingHistoryEntry = z.infer<
  typeof OrganizationBillingHistoryEntrySchema
>;

export const OrganizationBillingHistoryResponseSchema = loosePlainObject({
  organizationId: z.string(),
  entries: arraySchema(OrganizationBillingHistoryEntrySchema),
});

export type OrganizationBillingHistoryResponse = z.infer<
  typeof OrganizationBillingHistoryResponseSchema
>;

export function isOrganizationBillingHistoryEntry(
  value: unknown,
): value is OrganizationBillingHistoryEntry {
  return OrganizationBillingHistoryEntrySchema.safeParse(value).success;
}

export function isOrganizationBillingHistoryResponse(
  value: unknown,
): value is OrganizationBillingHistoryResponse {
  return OrganizationBillingHistoryResponseSchema.safeParse(value).success;
}
