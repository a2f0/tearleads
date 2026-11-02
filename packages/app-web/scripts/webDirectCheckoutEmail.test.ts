import { expect, test } from "bun:test";
import { createWebDirectCheckout } from "../src/webDirectCheckout";
import {
  APPEARANCE,
  type FakeHost,
  fakeStripe,
  host,
  withKey,
} from "./webDirectCheckout.testUtils";

/**
 * The billing email lives in Stripe's Contact Details element, mounted above
 * the Payment Element in the same app-owned host; confirm sends it.
 */

test("Stripe's email element sits above the card form and its email is sent", async () => {
  const { confirmInputs, created, stripe } = fakeStripe({
    email: " buyer@example.com ",
  });
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  const reported: (string | null)[] = [];
  const target = host();
  const session = await capability.mount({
    host: target,
    clientSecret: "pi_secret",
    onBillingEmailChange: (email) => reported.push(email),
    appearance: APPEARANCE,
  });

  await session.confirm();

  expect(created).toEqual([
    { type: "contactDetails", opts: undefined },
    {
      type: "payment",
      opts: { fields: { billingDetails: { email: "never" } } },
    },
  ]);
  expect((target as unknown as FakeHost).children).toHaveLength(2);
  expect(reported).toEqual(["buyer@example.com"]);
  const [input] = confirmInputs as [
    {
      confirmParams: {
        payment_method_data: { billing_details: { email: string } };
      };
    },
  ];
  expect(input.confirmParams.payment_method_data.billing_details.email).toBe(
    "buyer@example.com",
  );
});

test("confirm without a complete email declines without calling Stripe", async () => {
  const { confirmInputs, stripe } = fakeStripe({ email: null });
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  const reported: (string | null)[] = [];
  const session = await capability.mount({
    host: host(),
    clientSecret: "pi_secret",
    onBillingEmailChange: (email) => reported.push(email),
    appearance: APPEARANCE,
  });

  expect(await session.confirm()).toEqual({
    kind: "declined",
    message: "Enter a billing email.",
  });
  expect(reported).toEqual([null]);
  expect(confirmInputs).toEqual([]);
});

test("unmount destroys both elements and clears only the wrappers it added", async () => {
  const { destroyed, stripe } = fakeStripe();
  const capability = withKey(() =>
    createWebDirectCheckout(() => Promise.resolve(stripe as never)),
  );
  const target = host();
  const session = await capability.mount({
    host: target,
    clientSecret: "pi_secret",
    onBillingEmailChange: () => undefined,
    appearance: APPEARANCE,
  });

  session.unmount();

  expect(destroyed).toEqual(["contactDetails", "payment"]);
  expect((target as unknown as FakeHost).children).toEqual([]);
});
