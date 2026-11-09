import { expect, test } from "bun:test";
import { createWebDirectCheckout } from "../src/webDirectCheckout";
import {
  APPEARANCE,
  fakeStripe,
  host,
  withKey,
} from "./webDirectCheckout.testUtils";

/**
 * The host shows its loading state until Stripe's frames have rendered, so
 * readiness must wait for both elements and report exactly once.
 */

function mountWith(stripe: unknown) {
  const reports: string[] = [];
  const errors: unknown[] = [];
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  const session = capability.mount({
    host: host(),
    clientSecret: "pi_secret",
    onBillingEmailChange: () => undefined,
    onReady: () => reports.push("ready"),
    onLoadError: (error) => errors.push(error),
    appearance: APPEARANCE,
  });
  return { errors, reports, session };
}

test("the form is ready only once both Stripe elements have rendered", async () => {
  const { emit, stripe } = fakeStripe();
  const { reports, session } = mountWith(stripe);
  await session;

  emit("payment", "ready");
  emit("payment", "ready");
  expect(reports).toEqual([]);

  emit("contactDetails", "ready");
  emit("contactDetails", "ready");
  expect(reports).toEqual(["ready"]);
});

test("a payment element that fails to load reports an Error carrying Stripe's", async () => {
  const { emit, stripe } = fakeStripe();
  const { errors, reports, session } = mountWith(stripe);
  await session;
  const failure = { type: "invalid_request_error", message: "No intent." };

  emit("payment", "loaderror", { elementType: "payment", error: failure });

  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(Error);
  expect((errors[0] as Error).cause).toBe(failure);
  expect(reports).toEqual([]);
});

test("either element failing to load fails the form once and never readies it", async () => {
  const { emit, stripe } = fakeStripe();
  const { errors, reports, session } = mountWith(stripe);
  await session;
  const failure = { type: "api_connection_error" };

  emit("contactDetails", "loaderror", {
    elementType: "contactDetails",
    error: failure,
  });
  emit("payment", "loaderror", { elementType: "payment", error: failure });
  emit("payment", "ready");
  emit("contactDetails", "ready");

  expect(errors).toHaveLength(1);
  expect((errors[0] as Error).cause).toBe(failure);
  expect(reports).toEqual([]);
});
