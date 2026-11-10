import { expect, mock, test } from "bun:test";
import { createStripeCheckout, loadStripeCheckoutOptions } from "./billing";

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

test("Pay starts the organization's subscription at the shown Price", async () => {
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

test("a repriced Pay keeps its code and is not reported as a failure", async () => {
  const report = mock(() => undefined);

  await expect(
    createStripeCheckout({
      apiClient: {
        createStripeCheckout: async () =>
          refusal("billing_checkout_price_changed", report),
      },
      organizationId: "org-1",
      priceId: "price_sync",
    }),
  ).rejects.toMatchObject({ code: "billing_checkout_price_changed" });
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
