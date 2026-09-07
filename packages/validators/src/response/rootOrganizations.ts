import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
} from "../schema";
import { OrganizationBillingStatusSchema } from "./organizationBilling";
import { OrganizationBillingHistoryEntrySchema } from "./organizationBillingHistory";
import {
  RootIdentitySummaryResponseSchema,
  RootRosterSchema,
  rootOrganizationBillingShape,
} from "./root";

export const RootOrganizationSummaryResponseSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
  name: z.string(),
  createdAt: z.string(),
  billingStatus: OrganizationBillingStatusSchema.nullable(),
});
export type RootOrganizationSummaryResponse = z.infer<
  typeof RootOrganizationSummaryResponseSchema
>;

export const RootOrganizationsResponseSchema = loosePlainObject({
  organizations: arraySchema(RootOrganizationSummaryResponseSchema),
  nextCursor: z.string().nullable(),
});
export type RootOrganizationsResponse = z.infer<
  typeof RootOrganizationsResponseSchema
>;

const RootOrganizationBillingResponseSchema = loosePlainObject({
  ...rootOrganizationBillingShape,
  currentPeriodStartsAt: z.string().nullable(),
  providerCustomerId: z.string().nullable(),
  providerSubscriptionId: z.string().nullable(),
  providerProductId: z.string().nullable(),
  providerTransactionId: z.string().nullable(),
  entitlementId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const RootOrganizationStripeResponseSchema = loosePlainObject({
  customerId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  subscriptionItemId: z.string().nullable(),
  priceId: z.string().nullable(),
  lastInvoiceId: z.string().nullable(),
  desiredPaidCapacity: nonNegativeIntegerSchema,
  desiredRenewalQuantity: nonNegativeIntegerSchema,
  appliedPaidCapacity: nonNegativeIntegerSchema,
  observedQuantity: nonNegativeIntegerSchema.nullable(),
  lastSyncedAt: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
  attemptCount: nonNegativeIntegerSchema,
  lastError: z.string().nullable(),
});

export const RootOrganizationDetailResponseSchema = loosePlainObject({
  organization: RootOrganizationSummaryResponseSchema,
  billing: RootOrganizationBillingResponseSchema.nullable(),
  stripe: RootOrganizationStripeResponseSchema.nullable(),
  /** The 50 most recent merged durable billing events. */
  history: arraySchema(OrganizationBillingHistoryEntrySchema),
});
export type RootOrganizationDetailResponse = z.infer<
  typeof RootOrganizationDetailResponseSchema
>;

export const RootOrganizationIdentityResponseSchema = loosePlainObject({
  identity: RootIdentitySummaryResponseSchema,
  roster: RootRosterSchema,
});
export type RootOrganizationIdentityResponse = z.infer<
  typeof RootOrganizationIdentityResponseSchema
>;
export const RootOrganizationIdentitiesResponseSchema = loosePlainObject({
  identities: arraySchema(RootOrganizationIdentityResponseSchema),
  nextCursor: z.string().nullable(),
});
export type RootOrganizationIdentitiesResponse = z.infer<
  typeof RootOrganizationIdentitiesResponseSchema
>;
