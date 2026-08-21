import type { OrganizationBillingStatus } from "@symcrypt/api-shared/schema";
import type { RevenueCatBillingTransition } from "../../billing/revenuecatWebhook";

export type RevenueCatWebhookOutcome =
  | {
      readonly status: "applied";
      readonly organizationId: string;
      readonly billingStatus: OrganizationBillingStatus;
    }
  | { readonly status: "ignored"; readonly reason: string }
  | { readonly status: "duplicate" }
  /** Nothing was claimed; a non-2xx response asks RevenueCat to redeliver. */
  | { readonly status: "retry"; readonly reason: string };

export type AppliedRevenueCatTransition = Exclude<
  RevenueCatBillingTransition,
  { kind: "ignore" }
>;
