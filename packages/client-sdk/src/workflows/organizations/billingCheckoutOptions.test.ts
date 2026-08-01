import { expect, test } from "bun:test";
import { loadStripeCheckoutOptions } from "./billing";

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
  ).rejects.toThrow("exceeds the maximum subscription tier");
});
