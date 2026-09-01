import type { RevenueCatApiDeps } from "../../src/billing/revenueCatApi";

export function playReplacementApiDeps(input: {
  readonly appUserId: string;
  readonly predecessorSubscriptionId: string;
  readonly productId: string;
  readonly replacementRevenueCatSubscriptionId?: string;
  readonly replacementSubscriptionId: string;
}): RevenueCatApiDeps {
  const revenueCatSubscriptionId = "sub_verified_play_lineage";
  const fetchImpl = (async (request: RequestInfo | URL) => {
    const url = new URL(String(request));
    if (url.pathname.endsWith("/products/prod_replacement")) {
      return Response.json({ store_identifier: input.productId });
    }
    const identifier = url.searchParams.get("store_subscription_identifier");
    const isPredecessor = identifier === input.predecessorSubscriptionId;
    const isReplacement = identifier === input.replacementSubscriptionId;
    if (!isPredecessor && !isReplacement) {
      return Response.json({ items: [] });
    }
    return Response.json({
      items: [
        {
          customer_id: input.appUserId,
          environment: "production",
          gives_access: true,
          id:
            isReplacement && input.replacementRevenueCatSubscriptionId
              ? input.replacementRevenueCatSubscriptionId
              : revenueCatSubscriptionId,
          product_id: isReplacement ? "prod_replacement" : "prod_predecessor",
          store: "play_store",
          store_subscription_identifier: identifier,
        },
      ],
    });
  }) as typeof fetch;
  return {
    env: {
      REVENUECAT_PROJECT_ID: "proj_test",
      REVENUECAT_V2_SECRET_KEY: "sk_test",
    } as NodeJS.ProcessEnv,
    fetchImpl,
  };
}
