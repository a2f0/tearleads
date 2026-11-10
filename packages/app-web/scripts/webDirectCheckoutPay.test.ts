import { expect, mock, test } from "bun:test";
import { createWebDirectCheckout } from "../src/webDirectCheckout";
import {
  APPEARANCE,
  fakeStripe,
  host,
  PRICE,
  withKey,
} from "./webDirectCheckout.testUtils";

/**
 * Nothing exists on the server until the buyer pays: the form mounts for the
 * shown Price alone, and Pay validates it, has the server start the
 * subscription, then confirms that subscription's payment.
 */

function mountWith(stripe: unknown) {
  return withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  ).mount({
    host: host(),
    price: PRICE,
    onBillingEmailChange: () => undefined,
    onReady: () => undefined,
    onLoadError: () => undefined,
    appearance: APPEARANCE,
  });
}

test("the form mounts for the shown Price, card only, before any intent", async () => {
  const { elementsOptions, stripe } = fakeStripe();
  await mountWith(stripe);

  expect(elementsOptions[0]).toMatchObject({
    mode: "subscription",
    amount: 500,
    currency: "usd",
    allowedPaymentMethodTypes: ["card"],
  });
  expect(elementsOptions[0]).not.toHaveProperty("clientSecret");
});

test("Pay confirms the payment the server started, after the form validates", async () => {
  const { confirmInputs, stripe } = fakeStripe();
  const session = await mountWith(stripe);
  const startPayment = mock(() => Promise.resolve("pi_started"));

  expect(await session.confirm(startPayment)).toEqual({ kind: "succeeded" });
  expect(startPayment).toHaveBeenCalledTimes(1);
  expect(confirmInputs).toMatchObject([{ clientSecret: "pi_started" }]);
});

test("an invalid form is a decline and starts nothing on the server", async () => {
  const { confirmInputs, stripe } = fakeStripe({
    submitError: {
      type: "validation_error",
      message: "Your card number is incomplete.",
    },
  });
  const session = await mountWith(stripe);
  const startPayment = mock(() => Promise.resolve("pi_started"));

  expect(await session.confirm(startPayment)).toEqual({
    kind: "declined",
    message: "Your card number is incomplete.",
  });
  expect(startPayment).not.toHaveBeenCalled();
  expect(confirmInputs).toEqual([]);
});

test("a refused start rejects with the server's error and confirms nothing", async () => {
  const { confirmInputs, stripe } = fakeStripe();
  const session = await mountWith(stripe);
  const refusal = Object.assign(new Error("price changed"), {
    code: "billing_checkout_price_changed",
  });

  await expect(session.confirm(() => Promise.reject(refusal))).rejects.toBe(
    refusal,
  );
  expect(confirmInputs).toEqual([]);
});

test("leaving while the form validates starts nothing on the server", async () => {
  const { confirmInputs, stripe } = fakeStripe();
  const session = await mountWith(stripe);
  const startPayment = mock(() => Promise.resolve("pi_started"));
  // `confirm` is now awaiting `elements.submit()`.
  const outcome = session.confirm(startPayment);

  session.unmount();

  expect(await outcome).toEqual({ kind: "cancelled" });
  expect(startPayment).not.toHaveBeenCalled();
  expect(confirmInputs).toEqual([]);
});

test("leaving while the server starts the payment confirms nothing", async () => {
  const { confirmInputs, stripe } = fakeStripe();
  const session = await mountWith(stripe);
  const started = Promise.withResolvers<string>();
  const outcome = session.confirm(() => started.promise);

  session.unmount();
  started.resolve("pi_started");

  expect(await outcome).toEqual({ kind: "cancelled" });
  expect(confirmInputs).toEqual([]);
});

test("a declined card can be retried with another Pay", async () => {
  let declines = 1;
  const { confirmInputs, stripe } = fakeStripe();
  const confirmPayment = stripe.confirmPayment;
  stripe.confirmPayment = async (input: unknown) => {
    const result = await confirmPayment(input);
    if (declines > 0) {
      declines -= 1;
      return {
        error: { type: "card_error", message: "Your card was declined." },
      };
    }
    return result;
  };
  const session = await mountWith(stripe);
  const startPayment = () => Promise.resolve("pi_started");

  expect(await session.confirm(startPayment)).toEqual({
    kind: "declined",
    message: "Your card was declined.",
  });
  expect(await session.confirm(startPayment)).toEqual({ kind: "succeeded" });
  expect(confirmInputs).toHaveLength(2);
});
