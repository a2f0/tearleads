import type { OrganizationBillingHistoryEntry } from "@tearleads/client-sdk";
import { MiniAppRowText } from "../../../components/mini-app/rows/MiniAppRow";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { getOrgManagerSeatsLabel } from "../labels";
import { formatPrice, formatTotalAmount } from "./billingFormatters";

interface BillingHistoryEntryDetailsProps {
  readonly entry: OrganizationBillingHistoryEntry;
  readonly includeAuditFields?: boolean;
}

const REVENUECAT_CHARGE_EVENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
  "RENEWAL",
]);

function getSignedCount(count: number): string {
  return count >= 0 ? `+${count}` : String(count);
}

function getProviderLabel(
  provider: OrganizationBillingHistoryEntry["provider"],
): string {
  switch (provider) {
    case "revenuecat":
      return "RevenueCat";
    case "stripe":
      return "Stripe";
    case "internal":
      return "Internal";
  }
}

function getCategoryLabel(
  category: OrganizationBillingHistoryEntry["category"],
): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function getBillingReasonLabel(reason: string): string {
  switch (reason) {
    case "subscription_create":
      return "Initial subscription";
    case "subscription_cycle":
      return "Subscription renewal";
    case "subscription_update":
      return "Subscription update";
    case "subscription_threshold":
      return "Billing threshold";
    case "quote_accept":
      return "Accepted quote";
    case "automatic_pending_invoice_item_invoice":
      return "Pending invoice items";
    default:
      return reason
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
  }
}

function getPeriodLabel(entry: OrganizationBillingHistoryEntry): string | null {
  const isFreeTrial =
    entry.provider === "internal" &&
    (entry.eventType === "free_trial_initialized" ||
      entry.eventType === "free_trial_expired");
  const periodKind = isFreeTrial ? "Trial period" : "Billing period";
  if (entry.periodStartsAt !== null && entry.periodEndsAt !== null) {
    return `${periodKind}: ${formatMiniAppDate(entry.periodStartsAt)} – ${formatMiniAppDate(entry.periodEndsAt)}`;
  }
  if (entry.periodStartsAt !== null) {
    return `${periodKind} starts: ${formatMiniAppDate(entry.periodStartsAt)}`;
  }
  if (entry.periodEndsAt !== null) {
    return `${periodKind} ends: ${formatMiniAppDate(entry.periodEndsAt)}`;
  }
  return null;
}

function Detail({ children }: { readonly children: string }) {
  return (
    <MiniAppRowText muted truncate={false}>
      {children}
    </MiniAppRowText>
  );
}

function RawIdentifier({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  if (value === null) {
    return null;
  }
  return <Detail>{`${label}: ${value}`}</Detail>;
}

function InvoiceFacts({
  entry,
}: {
  readonly entry: OrganizationBillingHistoryEntry;
}) {
  if (entry.category !== "invoice") {
    return null;
  }
  const paidTotal = formatTotalAmount(
    entry.totalAmount,
    entry.totalCurrency,
    entry.provider,
  );
  const rate = formatPrice(
    entry.unitAmount,
    entry.currency,
    entry.interval,
    entry.intervalCount,
  );
  return (
    <>
      {paidTotal ? <Detail>{`Paid: ${paidTotal}`}</Detail> : null}
      {entry.billingReason !== null ? (
        <Detail>{`Invoice reason: ${getBillingReasonLabel(entry.billingReason)}`}</Detail>
      ) : null}
      <Detail>
        {entry.seatCount === null
          ? "Licensed seat count unavailable"
          : getOrgManagerSeatsLabel(entry.seatCount)}
      </Detail>
      <Detail>{rate ? `Plan price: ${rate}` : "Plan price unavailable"}</Detail>
    </>
  );
}

function LifecycleAvailability({
  entry,
}: {
  readonly entry: OrganizationBillingHistoryEntry;
}) {
  if (entry.category !== "lifecycle") {
    return null;
  }
  if (entry.eventType === "free_trial_initialized") {
    return <Detail>Free trial access granted at no charge</Detail>;
  }
  if (entry.eventType === "free_trial_expired") {
    return <Detail>Free trial ended and sync was disabled</Detail>;
  }
  if (entry.unitAmount !== null) {
    return null;
  }
  return (
    <Detail>
      {entry.seatCount === null
        ? "Seat and plan price unavailable for this event"
        : "Plan price unavailable for this event"}
    </Detail>
  );
}

function LifecyclePayment({
  entry,
}: {
  readonly entry: OrganizationBillingHistoryEntry;
}) {
  if (entry.category !== "lifecycle") {
    return null;
  }
  const paidTotal = formatTotalAmount(
    entry.totalAmount,
    entry.totalCurrency,
    entry.provider,
  );
  if (paidTotal) {
    return <Detail>{`Paid: ${paidTotal}`}</Detail>;
  }
  return entry.provider === "revenuecat" &&
    entry.environment === "sandbox" &&
    entry.outcome === "applied" &&
    REVENUECAT_CHARGE_EVENT_TYPES.has(entry.eventType) ? (
    <Detail>Sandbox transaction — no real charge</Detail>
  ) : null;
}

function LifecyclePrice({
  entry,
}: {
  readonly entry: OrganizationBillingHistoryEntry;
}) {
  if (entry.category !== "lifecycle") {
    return null;
  }
  const rate = formatPrice(
    entry.unitAmount,
    entry.currency,
    entry.interval,
    entry.intervalCount,
  );
  return rate ? <Detail>{`USD list price: ${rate}`}</Detail> : null;
}

function AuditFields({
  entry,
}: {
  readonly entry: OrganizationBillingHistoryEntry;
}) {
  return (
    <>
      <Detail>{`Category: ${getCategoryLabel(entry.category)}`}</Detail>
      <Detail>{`Provider: ${getProviderLabel(entry.provider)}`}</Detail>
      {entry.environment !== null ? (
        <Detail>{`Environment: ${entry.environment === "sandbox" ? "Sandbox" : "Production"}`}</Detail>
      ) : null}
      <Detail>{`Outcome: ${entry.outcome}`}</Detail>
      <RawIdentifier label="Product ID" value={entry.productId} />
      <RawIdentifier label="Price ID" value={entry.priceId} />
      <RawIdentifier label="Transaction ID" value={entry.transactionId} />
      <RawIdentifier label="Subscription ID" value={entry.subscriptionId} />
      <RawIdentifier label="Invoice ID" value={entry.invoiceId} />
    </>
  );
}

/**
 * Billing facts shared by the friendly activity and raw event views. Totals
 * are rendered only from the provider's explicit `totalAmount`; the fixed-plan
 * price is deliberately kept separate and is never treated as the paid total.
 */
export function BillingHistoryEntryDetails({
  entry,
  includeAuditFields = false,
}: BillingHistoryEntryDetailsProps) {
  const period = getPeriodLabel(entry);

  return (
    <>
      <InvoiceFacts entry={entry} />
      {entry.category !== "invoice" && entry.seatCount !== null ? (
        <Detail>{getOrgManagerSeatsLabel(entry.seatCount)}</Detail>
      ) : null}
      {entry.seatDelta !== null ? (
        <Detail>{`Licensed seat change: ${getSignedCount(entry.seatDelta)}`}</Detail>
      ) : null}
      {entry.category === "seat" ? (
        <Detail>Cost unavailable for this seat event</Detail>
      ) : null}
      <LifecyclePayment entry={entry} />
      <LifecyclePrice entry={entry} />
      <LifecycleAvailability entry={entry} />
      {period ? <Detail>{period}</Detail> : null}
      {includeAuditFields ? <AuditFields entry={entry} /> : null}
    </>
  );
}
