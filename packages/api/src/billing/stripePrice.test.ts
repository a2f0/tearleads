import { expect, spyOn, test } from "bun:test";
import { getStripeSyncOption } from "./stripePrice";

test("a configured Price with mismatched tier economics is rejected and logged", async () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "price_team_5",
        currency: "usd",
        unit_amount: 2_000,
        recurring: { interval: "month", interval_count: 1 },
      }),
    )) as typeof fetch;
  try {
    expect(
      await getStripeSyncOption("team_5", {
        env: {
          STRIPE_SECRET_KEY: "sk_test",
          STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
        },
        fetchImpl,
      }),
    ).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "Configured Stripe Price does not match its billing tier",
      expect.objectContaining({ tierId: "team_5" }),
    );
  } finally {
    errorSpy.mockRestore();
  }
});
