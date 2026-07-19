import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  extractPaidSubscriptionId,
  verifyStripeSignature,
} from "./stripeWebhook";

const SECRET = "whsec_test";

function sign(payload: string, timestampSeconds: number): string {
  const signature = createHmac("sha256", SECRET)
    .update(`${timestampSeconds}.${payload}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

test("accepts a fresh, correctly signed payload", () => {
  const payload = JSON.stringify({ type: "invoice.paid" });
  const timestamp = 1_700_000_000;
  expect(
    verifyStripeSignature({
      payload,
      signatureHeader: sign(payload, timestamp),
      secret: SECRET,
      nowMs: timestamp * 1000 + 60_000,
    }),
  ).toBe(true);
});

test("rejects a bad signature, a stale timestamp, and a missing header", () => {
  const payload = JSON.stringify({ type: "invoice.paid" });
  const timestamp = 1_700_000_000;
  expect(
    verifyStripeSignature({
      payload: `${payload} tampered`,
      signatureHeader: sign(payload, timestamp),
      secret: SECRET,
      nowMs: timestamp * 1000,
    }),
  ).toBe(false);
  expect(
    verifyStripeSignature({
      payload,
      signatureHeader: sign(payload, timestamp),
      secret: SECRET,
      // Beyond the five-minute replay tolerance.
      nowMs: timestamp * 1000 + 6 * 60 * 1000,
    }),
  ).toBe(false);
  expect(
    verifyStripeSignature({
      payload,
      signatureHeader: undefined,
      secret: SECRET,
      nowMs: timestamp * 1000,
    }),
  ).toBe(false);
});

function paidInvoiceEvent(invoice: Record<string, unknown>): unknown {
  return {
    type: "invoice.paid",
    data: { object: { billing_reason: "subscription_create", ...invoice } },
  };
}

test("extracts the subscription id from both invoice payload shapes", () => {
  // Older API versions: a top-level subscription reference.
  expect(
    extractPaidSubscriptionId(paidInvoiceEvent({ subscription: "sub_old" })),
  ).toBe("sub_old");
  expect(
    extractPaidSubscriptionId(
      paidInvoiceEvent({ subscription: { id: "sub_expanded" } }),
    ),
  ).toBe("sub_expanded");
  // Newer API versions: nested under parent.subscription_details.
  expect(
    extractPaidSubscriptionId(
      paidInvoiceEvent({
        parent: { subscription_details: { subscription: "sub_new" } },
      }),
    ),
  ).toBe("sub_new");
});

test("ignores other events, renewals, and malformed payloads", () => {
  expect(
    extractPaidSubscriptionId({
      type: "invoice.paid",
      data: {
        object: { billing_reason: "subscription_cycle", subscription: "sub" },
      },
    }),
  ).toBeNull();
  expect(
    extractPaidSubscriptionId({
      type: "customer.subscription.updated",
      data: { object: { subscription: "sub" } },
    }),
  ).toBeNull();
  expect(extractPaidSubscriptionId("not an event")).toBeNull();
  expect(extractPaidSubscriptionId(null)).toBeNull();
});
