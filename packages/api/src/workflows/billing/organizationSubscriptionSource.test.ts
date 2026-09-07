import { describe, expect, test } from "bun:test";
import { resolveOrganizationSubscriptionOwnership } from "./organizationSubscriptionSource";

const STRIPE = { env: { STRIPE_SYNC_SOLO_PRICE_ID: "price_solo" } };

function ownership(
  overrides: Partial<
    Parameters<typeof resolveOrganizationSubscriptionOwnership>[0]
  >,
) {
  return resolveOrganizationSubscriptionOwnership({
    hasActiveStripeSubscription: false,
    hasStripeSubscription: false,
    provider: null,
    providerCustomerId: null,
    providerProductId: null,
    status: "local",
    stripe: STRIPE,
    ...overrides,
  });
}

describe("resolveOrganizationSubscriptionOwnership", () => {
  test("nothing bound owns nothing", () => {
    expect(ownership({})).toEqual({
      canCancelDirectly: false,
      subscriptionSource: null,
    });
  });

  test("a native product owns while no priced Stripe binding is live", () => {
    expect(
      ownership({
        provider: "revenuecat",
        providerCustomerId: "user-1",
        providerProductId: "sync_team_5_monthly",
        status: "active",
      }),
    ).toEqual({ canCancelDirectly: false, subscriptionSource: "native" });
    // A quarantined Stripe identity keeps the direct-cancel path only while
    // the organization can still bill.
    expect(
      ownership({
        hasStripeSubscription: true,
        provider: "revenuecat",
        providerCustomerId: "user-1",
        providerProductId: "sync_team_5_monthly",
        status: "active",
      }),
    ).toEqual({ canCancelDirectly: true, subscriptionSource: "native" });
    expect(
      ownership({
        hasStripeSubscription: true,
        provider: "revenuecat",
        providerCustomerId: "user-1",
        providerProductId: "sync_team_5_monthly",
        status: "disabled",
      }),
    ).toEqual({ canCancelDirectly: false, subscriptionSource: "native" });
  });

  test("a live priced Stripe binding wins over a native-looking product", () => {
    expect(
      ownership({
        hasActiveStripeSubscription: true,
        hasStripeSubscription: true,
        provider: "revenuecat",
        providerCustomerId: "user-1",
        providerProductId: "sync_solo_monthly",
        status: "active",
      }),
    ).toEqual({ canCancelDirectly: true, subscriptionSource: "stripe" });
  });

  test.each(["active", "past_due", "trialing"] as const)(
    "a configured Stripe Price owns a %s organization",
    (status) => {
      expect(
        ownership({
          provider: "revenuecat",
          providerProductId: "price_solo",
          status,
        }),
      ).toEqual({ canCancelDirectly: true, subscriptionSource: "stripe" });
    },
  );

  test("a lapsed Stripe identity frees the organization to enroll again", () => {
    expect(
      ownership({
        provider: "revenuecat",
        providerProductId: "price_solo",
        status: "disabled",
      }),
    ).toEqual({ canCancelDirectly: false, subscriptionSource: null });
  });

  test("a remaining RevenueCat customer without a live identity is native", () => {
    expect(
      ownership({
        provider: "revenuecat",
        providerCustomerId: "user-1",
        providerProductId: "promotional:sync_solo_monthly",
        status: "active",
      }),
    ).toEqual({ canCancelDirectly: false, subscriptionSource: "native" });
  });
});
