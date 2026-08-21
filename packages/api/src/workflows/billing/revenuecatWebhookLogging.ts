import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import {
  isRevenueCatGrantEventType,
  NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
  PLAY_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON,
  SANDBOX_IGNORED_REASON,
} from "../../billing/revenuecatWebhook";

const ROUTINE_PAID_EVENT_IGNORE_REASONS = new Set([
  "A newer billing event has already been applied",
  "Grant event period has already expired",
  NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
  PLAY_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON,
  SANDBOX_IGNORED_REASON,
]);

/** Alerts on rejected paid events while leaving routine redeliveries quiet. */
export function logUnappliedRevenueCatPaidEvent(
  event: RevenueCatWebhookEvent,
  outcome: { readonly status: string; readonly reason?: string },
): void {
  if (
    outcome.status !== "ignored" ||
    typeof outcome.reason !== "string" ||
    (!isRevenueCatGrantEventType(event.type) &&
      event.type !== "PRODUCT_CHANGE") ||
    ROUTINE_PAID_EVENT_IGNORE_REASONS.has(outcome.reason)
  ) {
    return;
  }
  const paidEventKind =
    event.type === "PRODUCT_CHANGE" ? "product change" : "grant";
  console.error(
    `RevenueCat paid ${paidEventKind} ${event.id} was not applied: ${outcome.reason}`,
  );
}
