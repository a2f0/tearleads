import { expect, test } from "bun:test";

import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import { getDefaultApiServiceRuntime } from "../runtime";
import {
  cancelStripeSubscription,
  createStripePortalUrl,
} from "./stripeCheckout";

test("the portal ignores a subscription whose metadata names another org", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
    STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  };
  // The subscription is resolved by searching Stripe on our `orgId` metadata.
  // A result whose metadata does NOT match must never yield a portal, so a
  // pooled customer can't expose an unrelated organization's billing.
  const searchFetch = (async (_input: RequestInfo | URL) =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "sub_other",
            status: "active",
            customer: "cus_other",
            metadata: {
              userId: admin.userId,
              orgId: "22222222-2222-4222-8222-222222222222",
            },
          },
        ],
        has_more: false,
      }),
    )) as typeof fetch;

  const url = await createStripePortalUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    "https://app.example/billing",
    { stripe: { env: stripeEnv, fetchImpl: searchFetch } },
  );
  expect(url).toBeNull();
});

test("the portal returns a session for the org's live subscription", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
    STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  };
  const paths: string[] = [];
  const bodies: string[] = [];
  const portalFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    paths.push(path);
    if (path.includes("/subscriptions/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "sub_org",
              status: "active",
              customer: "cus_org",
              metadata: { userId: admin.userId, orgId: organizationId },
            },
          ],
          has_more: false,
        }),
      );
    }
    bodies.push(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({ url: "https://billing.stripe.com/p/session" }),
    );
  }) as typeof fetch;

  const url = await createStripePortalUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    "https://app.example/billing",
    { stripe: { env: stripeEnv, fetchImpl: portalFetch } },
  );
  expect(url).toBe("https://billing.stripe.com/p/session");
  expect(paths.some((path) => path.includes("/billing_portal/sessions"))).toBe(
    true,
  );
  expect(bodies.some((body) => body.includes("customer=cus_org"))).toBe(true);
});

test("cancel schedules the period end for the org's live subscription", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
    STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  };
  const paths: string[] = [];
  const cancelFetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    paths.push(path);
    if (path.includes("/subscriptions/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "sub_org",
              status: "active",
              customer: "cus_org",
              metadata: { userId: admin.userId, orgId: organizationId },
            },
          ],
          has_more: false,
        }),
      );
    }
    return new Response(
      JSON.stringify({ id: "sub_org", cancel_at: 1893456000 }),
    );
  }) as typeof fetch;

  const result = await cancelStripeSubscription(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: stripeEnv, fetchImpl: cancelFetch } },
  );
  expect(result).toEqual({ cancelAt: 1893456000 });
  expect(paths.some((path) => path.endsWith("/subscriptions/sub_org"))).toBe(
    true,
  );
});

test("cancel resolves the Stripe sub_ even when the billing row holds an si_ id", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  // Reproduce the staging state: the RevenueCat webhook wrote the Stripe
  // subscription ITEM id (si_…) to the billing row, not the sub_… . The old
  // resolver read that column and 404'd; the search-based resolver recovers.
  await db
    .update(organizationBilling)
    .set({ providerSubscriptionId: "si_item123", status: "active" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
    STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/subscriptions/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "sub_real",
              status: "active",
              customer: "cus_real",
              metadata: { userId: admin.userId, orgId: organizationId },
            },
          ],
          has_more: false,
        }),
      );
    }
    return new Response(
      JSON.stringify({ id: "sub_real", cancel_at: 1893456000 }),
    );
  }) as typeof fetch;

  const result = await cancelStripeSubscription(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: stripeEnv, fetchImpl } },
  );
  expect(result).toEqual({ cancelAt: 1893456000 });
});

test("cancel does nothing when the org has only an incomplete subscription", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
    STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  };
  // An incomplete subscription has nothing to cancel.
  const paths: string[] = [];
  const incompleteFetch = (async (input: RequestInfo | URL) => {
    paths.push(String(input));
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "sub_incomplete",
            status: "incomplete",
            customer: "cus_1",
            metadata: { userId: admin.userId, orgId: organizationId },
          },
        ],
        has_more: false,
      }),
    );
  }) as typeof fetch;

  const result = await cancelStripeSubscription(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: stripeEnv, fetchImpl: incompleteFetch } },
  );
  expect(result).toBeNull();
  expect(paths.every((path) => path.includes("/subscriptions/search"))).toBe(
    true,
  );
});
