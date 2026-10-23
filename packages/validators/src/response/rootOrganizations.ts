import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
} from "../schema";
import { OrganizationBillingStatusSchema } from "./organizationBilling";
import { OrganizationBillingHistoryEntrySchema } from "./organizationBillingHistory";
import { OrganizationDataUsageResponseSchema } from "./organizationDataUsage";
import {
  RootIdentitySummaryResponseSchema,
  RootRosterSchema,
  rootOrganizationBillingShape,
} from "./root";

export const RootOrganizationSummaryResponseSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
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
  purgeStartedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Persisted group bindings plus roster and seat counts; no names or content. */
const RootOrganizationOverviewResponseSchema = loosePlainObject({
  adminGroupId: nonEmptyStringSchema,
  memberGroupId: nonEmptyStringSchema,
  activeMemberCount: nonNegativeIntegerSchema,
  disabledMemberCount: nonNegativeIntegerSchema,
  /** Active members who paused the organization's sync to their devices. */
  syncPausedMemberCount: nonNegativeIntegerSchema,
  /** Unreleased billable-seat assignments, the billing panel's assigned seats. */
  openSeatAssignmentCount: nonNegativeIntegerSchema,
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
  overview: RootOrganizationOverviewResponseSchema,
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

export const RootDataUsageReportResponseSchema = loosePlainObject({
  organizations: arraySchema(
    loosePlainObject({
      organization: RootOrganizationSummaryResponseSchema,
      dataUsage: OrganizationDataUsageResponseSchema,
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type RootDataUsageReportResponse = z.infer<
  typeof RootDataUsageReportResponseSchema
>;
