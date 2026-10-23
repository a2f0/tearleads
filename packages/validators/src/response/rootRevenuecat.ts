import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  safeIntegerSchema,
} from "../schema";

/**
 * Which deliveries the RevenueCat report lists: ones that resolved to no
 * organization, ones the handler deliberately ignored, or either.
 */
export const ROOT_REVENUECAT_DISPOSITIONS = [
  "unmatched",
  "ignored",
  "both",
] as const;

export const RootRevenuecatDispositionSchema = z.literal(
  ROOT_REVENUECAT_DISPOSITIONS,
);

export type RootRevenuecatDisposition = z.infer<
  typeof RootRevenuecatDispositionSchema
>;

const revenuecatEventShape = {
  /** Server row id; it anchors the next page's cursor. */
  id: nonEmptyStringSchema,
  /** RevenueCat's own event id, as its dashboard shows it. */
  eventId: nonEmptyStringSchema,
  eventType: nonEmptyStringSchema,
  /** How the webhook handler dispositioned the delivery. */
  outcome: nonEmptyStringSchema,
  /** RevenueCat App User ID; the client sets it to the buyer's user id. */
  appUserId: z.string(),
  /** Organization the event was applied to; null when none resolved. */
  organizationId: nonEmptyStringSchema.nullable(),
  /** Previous owner for a `TRANSFER`. */
  sourceOrganizationId: nonEmptyStringSchema.nullable(),
  store: z.string().nullable(),
  environment: z.string().nullable(),
  productId: z.string().nullable(),
  periodType: z.string().nullable(),
  transactionId: z.string().nullable(),
  originalTransactionId: z.string().nullable(),
  currency: z.string().nullable(),
  /** Store transaction price in the currency's minor unit. */
  priceInPurchasedCurrencyMinor: safeIntegerSchema.nullable(),
  purchasedAt: z.string().nullable(),
  expirationAt: z.string().nullable(),
  /** Provider-reported event time; listings are newest first by it. */
  eventTimestamp: z.string(),
  /** When the server stored the delivery. */
  createdAt: z.string(),
};

/** One stored RevenueCat webhook delivery. */
export const RootRevenuecatEventResponseSchema =
  loosePlainObject(revenuecatEventShape);

export type RootRevenuecatEventResponse = z.infer<
  typeof RootRevenuecatEventResponseSchema
>;

export const ROOT_REVENUECAT_EVENT_ROLES = ["target", "source"] as const;

/**
 * One delivery as an organization saw it: the organization it was applied to
 * (`target`), or the previous owner a `TRANSFER` moved the purchase from
 * (`source`).
 */
export const RootOrganizationRevenuecatEventResponseSchema = loosePlainObject({
  ...revenuecatEventShape,
  role: z.literal(ROOT_REVENUECAT_EVENT_ROLES),
});

export type RootOrganizationRevenuecatEventResponse = z.infer<
  typeof RootOrganizationRevenuecatEventResponseSchema
>;

export const RootOrganizationRevenuecatEventsResponseSchema = loosePlainObject({
  events: arraySchema(RootOrganizationRevenuecatEventResponseSchema),
  /** Opaque cursor for the next page; null when the listing is exhausted. */
  nextCursor: z.string().nullable(),
});

export type RootOrganizationRevenuecatEventsResponse = z.infer<
  typeof RootOrganizationRevenuecatEventsResponseSchema
>;

export const RootRevenuecatEventsReportResponseSchema = loosePlainObject({
  events: arraySchema(RootRevenuecatEventResponseSchema),
  /** Opaque cursor for the next page; null when the listing is exhausted. */
  nextCursor: z.string().nullable(),
});

export type RootRevenuecatEventsReportResponse = z.infer<
  typeof RootRevenuecatEventsReportResponseSchema
>;
