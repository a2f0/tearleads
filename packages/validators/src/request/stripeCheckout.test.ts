import { expect, test } from "bun:test";
import {
  isStripeReturnUrlRequest,
  StripeReturnUrlRequestSchema,
} from "./stripeCheckout";

test("Stripe return URL requests preserve extensions and input identity", () => {
  const input = {
    returnUrl: "https://app.example/billing",
    futureRequestField: true,
  };
  const result = StripeReturnUrlRequestSchema.safeParse(input);

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data as unknown).toBe(input);
  }
  expect(isStripeReturnUrlRequest(input)).toBe(true);
  expect(isStripeReturnUrlRequest({})).toBe(false);
  expect(isStripeReturnUrlRequest({ returnUrl: 5 })).toBe(false);
});
