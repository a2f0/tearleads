import type { RootOrganizationDetail } from "@tearleads/client-sdk";
import {
  MiniAppInfoHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { formatRootTimestamp as date } from "../identities/rootDisplay";
import { RootFacts } from "./RootFacts";

export function OrganizationBilling({
  billing,
  stripe,
}: Pick<RootOrganizationDetail, "billing" | "stripe">) {
  return (
    <>
      <MiniAppInfoHeading>Billing</MiniAppInfoHeading>
      <MiniAppStatus>
        Stored billing state. Dates and provider references reflect the latest
        recorded updates.
      </MiniAppStatus>
      {billing ? (
        <RootFacts
          label="Organization billing"
          facts={[
            { label: "Status", value: billing.status },
            { label: "Provider", value: billing.provider },
            { label: "Licensed seats", value: billing.seatCount },
            { label: "Trial ends", value: date(billing.trialEndsAt) },
            {
              label: "Period starts",
              value: date(billing.currentPeriodStartsAt),
            },
            { label: "Period ends", value: date(billing.currentPeriodEndsAt) },
            { label: "Disabled", value: date(billing.disabledAt) },
            { label: "Purge after", value: date(billing.purgeAfter) },
            { label: "Purged", value: date(billing.purgedAt) },
            {
              label: "Customer ID",
              value: billing.providerCustomerId,
              copy: true,
            },
            {
              label: "Subscription ID",
              value: billing.providerSubscriptionId,
              copy: true,
            },
            {
              label: "Product ID",
              value: billing.providerProductId,
              copy: true,
            },
            {
              label: "Transaction ID",
              value: billing.providerTransactionId,
              copy: true,
            },
            {
              label: "Entitlement ID",
              value: billing.entitlementId,
              copy: true,
            },
            { label: "Billing created", value: date(billing.createdAt) },
            { label: "Billing updated", value: date(billing.updatedAt) },
          ]}
        />
      ) : (
        <MiniAppStatus>No billing record.</MiniAppStatus>
      )}
      <MiniAppInfoHeading>Stripe</MiniAppInfoHeading>
      {stripe ? (
        <RootFacts
          label="Stripe billing"
          facts={[
            {
              label: "Stripe customer ID",
              value: stripe.customerId,
              copy: true,
            },
            {
              label: "Stripe subscription ID",
              value: stripe.subscriptionId,
              copy: true,
            },
            {
              label: "Subscription item ID",
              value: stripe.subscriptionItemId,
              copy: true,
            },
            { label: "Price ID", value: stripe.priceId, copy: true },
            {
              label: "Last invoice ID",
              value: stripe.lastInvoiceId,
              copy: true,
            },
            {
              label: "Desired paid capacity",
              value: stripe.desiredPaidCapacity,
            },
            { label: "Renewal quantity", value: stripe.desiredRenewalQuantity },
            {
              label: "Applied paid capacity",
              value: stripe.appliedPaidCapacity,
            },
            { label: "Observed quantity", value: stripe.observedQuantity },
            { label: "Last synced", value: date(stripe.lastSyncedAt) },
            { label: "Next retry", value: date(stripe.nextAttemptAt) },
            { label: "Retry count", value: stripe.attemptCount },
            { label: "Last sync error", value: stripe.lastError },
          ]}
        />
      ) : (
        <MiniAppStatus>No Stripe billing record.</MiniAppStatus>
      )}
    </>
  );
}
