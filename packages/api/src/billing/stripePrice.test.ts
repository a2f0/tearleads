import { expect, spyOn, test } from "bun:test";
import { getStripeSyncOption } from "./stripePrice";

const ENV = {
  STRIPE_SECRET_KEY: "sk_test",
  STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
};
const VALID_PRICE = {
  active: true,
  currency: "usd",
  id: "price_team_5",
  product: { active: true, id: "prod_sync" },
  recurring: { interval: "month", interval_count: 1 },
  unit_amount: 1_000,
};

function responseFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    Response.json(body, { status })) as unknown as typeof fetch;
}

test("a configured Price with mismatched tier economics is rejected and logged", async () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(
      await getStripeSyncOption("team_5", {
        env: ENV,
        fetchImpl: responseFetch({ ...VALID_PRICE, unit_amount: 2_000 }),
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

test("an inactive configured Price is rejected with an operator diagnostic", async () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(
      await getStripeSyncOption("team_5", {
        env: ENV,
        fetchImpl: responseFetch({ ...VALID_PRICE, active: false }),
      }),
    ).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "Configured Stripe catalog entry is unusable",
      expect.objectContaining({
        reason: "Price is inactive",
        tierId: "team_5",
      }),
    );
  } finally {
    errorSpy.mockRestore();
  }
});

test("an inactive associated Product is rejected with an operator diagnostic", async () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(
      await getStripeSyncOption("team_5", {
        env: ENV,
        fetchImpl: responseFetch({
          ...VALID_PRICE,
          product: { active: false, id: "prod_sync" },
        }),
      }),
    ).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "Configured Stripe catalog entry is unusable",
      expect.objectContaining({
        productId: "prod_sync",
        reason: "Product is inactive",
        tierId: "team_5",
      }),
    );
  } finally {
    errorSpy.mockRestore();
  }
});

test("a malformed Product expansion is rejected with an operator diagnostic", async () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(
      await getStripeSyncOption("team_5", {
        env: ENV,
        fetchImpl: responseFetch({ ...VALID_PRICE, product: "prod_sync" }),
      }),
    ).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "Configured Stripe catalog entry is unusable",
      expect.objectContaining({
        reason: "Expanded Product is missing or invalid",
        tierId: "team_5",
      }),
    );
  } finally {
    errorSpy.mockRestore();
  }
});

test("a Stripe catalog lookup failure remains a provider error", async () => {
  await expect(
    getStripeSyncOption("team_5", {
      env: ENV,
      fetchImpl: responseFetch({}, 503),
    }),
  ).rejects.toMatchObject({ name: "StripeApiError", status: 503 });
});
