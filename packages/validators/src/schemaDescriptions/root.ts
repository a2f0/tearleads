import { describeSchema } from "../jsonSchemaAnnotations";
import {
  RootAuditEventResponseSchema,
  RootAuditEventsResponseSchema,
  RootDataUsageReportResponseSchema,
  RootIdentitiesResponseSchema,
  RootIdentityDetailResponseSchema,
  RootIdentityOrganizationBillingResponseSchema,
  RootIdentityOrganizationResponseSchema,
  RootIdentityOrganizationsResponseSchema,
  RootIdentitySessionResponseSchema,
  RootIdentitySummaryResponseSchema,
  RootIdentitySuspensionResponseSchema,
  RootOpsHealthReportResponseSchema,
  RootOrganizationDetailResponseSchema,
  RootOrganizationIdentitiesResponseSchema,
  RootOrganizationIdentityResponseSchema,
  RootOrganizationRevenuecatEventResponseSchema,
  RootOrganizationRevenuecatEventsResponseSchema,
  RootOrganizationSummaryResponseSchema,
  RootOrganizationsResponseSchema,
  RootRevenuecatEventResponseSchema,
  RootRevenuecatEventsReportResponseSchema,
} from "../response";

describeSchema(
  RootIdentitySummaryResponseSchema,
  "An operator's view of one registered identity.",
  {
    defaultOrganizationId: "The identity's personal organization.",
    isRoot: "True for a platform operator.",
    registrationSourceIpAddress:
      "IP address the identity registered from, when recorded.",
    suspendedAt: "When an operator suspended the identity, or null.",
  },
);

describeSchema(
  RootIdentitiesResponseSchema,
  "A page of registered identities, newest first.",
  { nextCursor: "Opaque cursor for the next page, or null at the end." },
);

describeSchema(
  RootIdentitySessionResponseSchema,
  "A live session of the inspected identity.",
);

describeSchema(
  RootIdentityDetailResponseSchema,
  "One identity with its live sessions.",
);

describeSchema(
  RootIdentitySuspensionResponseSchema,
  "The identity after a suspension was placed or lifted.",
);

describeSchema(
  RootIdentityOrganizationBillingResponseSchema,
  "The billing standing of one organization in an identity's list.",
);

describeSchema(
  RootIdentityOrganizationResponseSchema,
  "One organization of an inspected identity, with the identity's roster entry there.",
  {
    billing:
      "The organization's billing standing; null only when it has no billing row.",
    isDefaultOrganization: "True for the identity's personal organization.",
  },
);

describeSchema(
  RootIdentityOrganizationsResponseSchema,
  "The organizations an identity belongs to.",
);

describeSchema(
  RootOrganizationSummaryResponseSchema,
  "An operator's view of one organization; names are encrypted, so none is shown.",
);

describeSchema(
  RootOrganizationsResponseSchema,
  "A page of organizations, newest first.",
  { nextCursor: "Opaque cursor for the next page, or null at the end." },
);

describeSchema(
  RootOrganizationDetailResponseSchema,
  "One organization's group bindings, roster counts, stored billing, Stripe binding, and recent billing events.",
  { history: "The 50 most recent billing events." },
);

describeSchema(
  RootOrganizationIdentityResponseSchema,
  "One roster identity of an inspected organization.",
);

describeSchema(
  RootOrganizationIdentitiesResponseSchema,
  "A page of an organization's roster identities, disabled entries included.",
  { nextCursor: "Opaque cursor for the next page, or null at the end." },
);

describeSchema(
  RootDataUsageReportResponseSchema,
  "A page of stored data usage by organization.",
  { nextCursor: "Opaque cursor for the next page, or null at the end." },
);

describeSchema(
  RootOpsHealthReportResponseSchema,
  "Billing maintenance trouble across organizations. Each section lists at most a bounded number of rows and says when it was truncated.",
  {
    seatSync:
      "Stripe seat syncs that are failing, overdue, or hold a lapsed lease, in retry order.",
    trialExpiry:
      "Ended trials the expiry sweep failed on or has not reached in time.",
    purges: "Purges past due to start, or started with a lapsed lease.",
    trialsEnding: "Trials ending soon, soonest first.",
    purgesDue: "Disabled organizations whose purge falls due soon.",
  },
);

describeSchema(
  RootRevenuecatEventResponseSchema,
  "One stored RevenueCat webhook delivery.",
  {
    outcome: "What the handler did with it.",
    organizationId:
      "Organization the delivery resolved to, or null when it matched none.",
    sourceOrganizationId:
      "For a transfer, the organization the purchase moved away from.",
    priceInPurchasedCurrencyMinor:
      "Price in the purchase currency's minor unit.",
  },
);

describeSchema(
  RootOrganizationRevenuecatEventResponseSchema,
  "One RevenueCat delivery as an organization saw it.",
  {
    role: "`target` when the delivery resolved to this organization; `source` when a transfer moved the purchase away from it.",
  },
);

describeSchema(
  RootOrganizationRevenuecatEventsResponseSchema,
  "A page of an organization's RevenueCat deliveries, newest first by event time.",
  { nextCursor: "Opaque cursor for the next page, or null at the end." },
);

describeSchema(
  RootRevenuecatEventsReportResponseSchema,
  "A page of RevenueCat deliveries that matched no organization or that the handler ignored.",
  { nextCursor: "Opaque cursor for the next page, or null at the end." },
);

describeSchema(RootAuditEventResponseSchema, "One recorded operator action.", {
  action:
    "Operation id of the request, or the CLI action that changed an operator flag.",
  actorSigningKeyFingerprint:
    "Signing key of the acting operator; null when the API CLI acted.",
  actorUserId: "The acting operator; null when the API CLI acted.",
  filter: "Listing filters as a sorted query string; null when none applied.",
  targetOrganizationId:
    "Organization the action looked up or changed, when it named one.",
  targetUserId: "Identity the action looked up or changed, when it named one.",
});

describeSchema(
  RootAuditEventsResponseSchema,
  "A page of recorded operator actions, newest first.",
  { nextCursor: "Opaque cursor for the next page, or null at the end." },
);
