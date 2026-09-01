import { expect, test } from "bun:test";
import { playReplacementApiDeps } from "../../test/helpers/revenuecatPlayReplacement";
import { verifyRevenueCatPlaySubscriptionReplacement } from "./revenueCatApi";

const INPUT = {
  appUserId: "user-1",
  predecessorSubscriptionId: "GPA.predecessor",
  productId: "sync_team_5_monthly",
  replacementSubscriptionId: "GPA.replacement",
};

test("verifies two Play identifiers on one RevenueCat subscription", async () => {
  expect(
    await verifyRevenueCatPlaySubscriptionReplacement(
      INPUT,
      playReplacementApiDeps(INPUT),
    ),
  ).toEqual({ kind: "verified" });
});

test("rejects a competing Play identifier owned by the same buyer", async () => {
  expect(
    await verifyRevenueCatPlaySubscriptionReplacement(INPUT, {
      ...playReplacementApiDeps({
        ...INPUT,
        replacementRevenueCatSubscriptionId: "sub_competing",
      }),
    }),
  ).toEqual({ kind: "not_found" });
});

test("defers replacement settlement when RevenueCat is unavailable", async () => {
  expect(
    await verifyRevenueCatPlaySubscriptionReplacement(INPUT, {
      env: {
        REVENUECAT_PROJECT_ID: "proj_test",
        REVENUECAT_V2_SECRET_KEY: "sk_test",
      } as NodeJS.ProcessEnv,
      fetchImpl: (async () =>
        new Response(null, { status: 503 })) as unknown as typeof fetch,
    }),
  ).toEqual({ kind: "unavailable" });
});

test("does not trust a partial identifier search after a later 404", async () => {
  const fetchImpl = (async (request: RequestInfo | URL) => {
    const url = new URL(String(request));
    const identifier = url.searchParams.get("store_subscription_identifier");
    if (identifier === INPUT.replacementSubscriptionId) {
      return Response.json({
        items: [
          {
            customer_id: INPUT.appUserId,
            environment: "production",
            gives_access: true,
            id: "sub_shared",
            product_id: "prod_replacement",
            store: "play_store",
          },
        ],
      });
    }
    if (url.searchParams.has("starting_after")) {
      return new Response(null, { status: 404 });
    }
    return Response.json({
      items: [{ customer_id: INPUT.appUserId, id: "sub_shared" }],
      next_page:
        "/v2/projects/proj_test/subscriptions?store_subscription_identifier=GPA.predecessor&starting_after=sub_shared",
    });
  }) as typeof fetch;
  expect(
    await verifyRevenueCatPlaySubscriptionReplacement(INPUT, {
      ...playReplacementApiDeps(INPUT),
      fetchImpl,
    }),
  ).toEqual({ kind: "unavailable" });
});
