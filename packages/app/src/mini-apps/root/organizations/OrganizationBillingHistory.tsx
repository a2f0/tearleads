import type { OrganizationBillingHistoryEntry } from "@tearleads/client-sdk";
import {
  MiniAppInfoHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { formatPrice, formatTotalAmount } from "../../shared/billingFormatters";
import { formatRootTimestamp } from "../identities/rootDisplay";
import { RootFacts } from "./RootFacts";

const date = (value: string | null) =>
  formatRootTimestamp(value, "Not recorded");

export function OrganizationBillingHistory({
  entries,
}: {
  entries: ReadonlyArray<OrganizationBillingHistoryEntry>;
}) {
  return (
    <>
      <MiniAppInfoHeading>Billing history</MiniAppInfoHeading>
      <MiniAppStatus>
        Latest 50 recorded events, newest first. Older records remain in the
        billing audit history.
      </MiniAppStatus>
      {entries.length === 0 && (
        <MiniAppStatus>No billing history recorded.</MiniAppStatus>
      )}
      {entries.map((entry) => (
        <details className="root-console-history-entry" key={entry.id}>
          <summary>
            {date(entry.occurredAt)} · {entry.eventType} · {entry.provider} ·{" "}
            {entry.outcome}
          </summary>
          <RootFacts
            label={`Billing event ${entry.id}`}
            facts={[
              { label: "Event ID", value: entry.id, copy: true },
              { label: "Category", value: entry.category },
              { label: "Environment", value: entry.environment },
              {
                label: "Recorded total",
                value:
                  formatTotalAmount(
                    entry.totalAmount,
                    entry.totalCurrency,
                    entry.provider,
                  ) || null,
              },
              {
                label:
                  entry.provider === "revenuecat"
                    ? "USD list price"
                    : "Unit price",
                value:
                  formatPrice(
                    entry.unitAmount,
                    entry.currency,
                    entry.interval,
                    entry.intervalCount,
                  ) || null,
              },
              { label: "Billing reason", value: entry.billingReason },
              { label: "Licensed seats", value: entry.seatCount },
              { label: "Seat change", value: entry.seatDelta },
              { label: "Active seats", value: entry.activeSeatCount },
              { label: "Period starts", value: date(entry.periodStartsAt) },
              { label: "Period ends", value: date(entry.periodEndsAt) },
              { label: "Invoice ID", value: entry.invoiceId, copy: true },
              {
                label: "Subscription ID",
                value: entry.subscriptionId,
                copy: true,
              },
              {
                label: "Transaction ID",
                value: entry.transactionId,
                copy: true,
              },
              { label: "Product ID", value: entry.productId, copy: true },
              { label: "Price ID", value: entry.priceId, copy: true },
            ]}
          />
        </details>
      ))}
    </>
  );
}
