import { expect, mock, test } from "bun:test";
import {
  createStripeCheckout,
  createStripeCheckoutSession,
  loadStripeCheckoutOptions,
} from "./billing";

test("checkout options return the detailed API result data", async () => {
  const result = await loadStripeCheckoutOptions({
    apiClient: {
      getStripeCheckoutOptions: async () => ({
        data: { options: [] },
        ok: true as const,
      }),
    },
    organizationId: "org-1",
  });

  expect(result).toEqual({ options: [] });
});

test("checkout option failures retain the server's actionable reason", async () => {
  await expect(
    loadStripeCheckoutOptions({
      apiClient: {
        getStripeCheckoutOptions: async () => ({
          code: "billing_roster_over_capacity",
          kind: "http" as const,
          message:
            "409 Conflict: The organization exceeds the maximum subscription tier of 10 members",
          method: "GET" as const,
          ok: false as const,
          path: "/billing/stripe/options",
          report: () => undefined,
          status: 409,
          statusText: "Conflict",
        }),
      },
      organizationId: "org-1",
    }),
  ).rejects.toMatchObject({
    code: "billing_roster_over_capacity",
    message:
      "409 Conflict: The organization exceeds the maximum subscription tier of 10 members",
  });
});

function refusal(code: string | undefined, report: () => void) {
  return {
    ...(code === undefined ? {} : { code }),
    kind: "http" as const,
    message: "409 Conflict: refused",
    method: "POST" as const,
    ok: false as const,
    path: "/organizations/org-1/billing/stripe/checkout",
    report,
    status: 409,
    statusText: "Conflict",
  };
}

test("Pay starts the organization's subscription at the chosen plan", async () => {
  const createStripeCheckoutApi = mock(
    async (_organizationId: string, _priceId: string) => ({
      data: { clientSecret: "pi_secret", subscriptionId: "sub_1" },
      ok: true as const,
    }),
  );

  const intent = await createStripeCheckout({
    apiClient: { createStripeCheckout: createStripeCheckoutApi },
    organizationId: "org-1",
    priceId: "price_team_5",
  });

  expect(intent).toEqual({
    clientSecret: "pi_secret",
    subscriptionId: "sub_1",
  });
  expect(createStripeCheckoutApi.mock.calls[0]?.slice(0, 2)).toEqual([
    "org-1",
    "price_team_5",
  ]);
});

test("a Pay for a plan no longer offered keeps its code and is not reported", async () => {
  const report = mock(() => undefined);

  await expect(
    createStripeCheckout({
      apiClient: {
        createStripeCheckout: async () =>
          refusal("billing_checkout_plan_unavailable", report),
      },
      organizationId: "org-1",
      priceId: "price_sync",
    }),
  ).rejects.toMatchObject({ code: "billing_checkout_plan_unavailable" });
  expect(report).not.toHaveBeenCalled();
});

test("any other refused Pay keeps its code and is reported", async () => {
  for (const code of ["billing_roster_over_capacity", undefined]) {
    const report = mock(() => undefined);

    const failure = await createStripeCheckout({
      apiClient: { createStripeCheckout: async () => refusal(code, report) },
      organizationId: "org-1",
      priceId: "price_sync",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    const failureCode =
      failure instanceof Error && "code" in failure ? failure.code : undefined;
    expect(failureCode).toBe(code);
    expect(report).toHaveBeenCalledTimes(1);
  }
});

test("the hosted fallback opens for the chosen plan", async () => {
  const createStripeCheckoutSessionApi = mock(
    async (_organizationId: string, _priceId: string, _returnUrl: string) => ({
      data: { url: "https://checkout.stripe.com/pay/cs_1" },
      ok: true as const,
    }),
  );

  const session = await createStripeCheckoutSession({
    apiClient: { createStripeCheckoutSession: createStripeCheckoutSessionApi },
    organizationId: "org-1",
    priceId: "price_team_5",
    returnUrl: "https://app.example/billing",
  });

  expect(session).toEqual({ url: "https://checkout.stripe.com/pay/cs_1" });
  expect(createStripeCheckoutSessionApi.mock.calls[0]?.slice(0, 3)).toEqual([
    "org-1",
    "price_team_5",
    "https://app.example/billing",
  ]);
});

test("a hosted session for a plan no longer offered is refused quietly", async () => {
  const report = mock(() => undefined);

  await expect(
    createStripeCheckoutSession({
      apiClient: {
        createStripeCheckoutSession: async () =>
          refusal("billing_checkout_plan_unavailable", report),
      },
      organizationId: "org-1",
      priceId: "price_sync",
      returnUrl: "https://app.example/billing",
    }),
  ).rejects.toMatchObject({ code: "billing_checkout_plan_unavailable" });
  expect(report).not.toHaveBeenCalled();
});
