import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizations,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { and, desc, eq } from "drizzle-orm";
import invariant from "invariant";
import {
  registerAndAuthenticateWithOrganization,
  registerUser,
} from "../../../test/helpers/registerUser";
import { addEffectiveOrganizationMember } from "../../../test/helpers/revenuecatWebhook";
import {
  REVENUECAT_WEBHOOK_ENV as REVENUECAT_ENV,
  STRIPE_WEBHOOK_ENV as STRIPE_ENV,
} from "../../../test/helpers/stripeWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import { createStripeCheckout } from "./stripeCheckout";
import { createStripeCheckoutSession } from "./stripeHostedCheckout";

async function loadCurrentMemberGroupState(organizationId: string): Promise<{
  readonly memberGroupId: string;
  readonly stateHash: string;
}> {
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization row");

  const [state] = await db
    .select({ stateHash: principalStates.stateHash })
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, "group"),
        eq(principalStates.principalId, organization.memberGroupId),
      ),
    )
    .orderBy(desc(principalStates.version))
    .limit(1);
  invariant(state, "expected current Members-group state");
  return {
    memberGroupId: organization.memberGroupId,
    stateHash: state.stateHash,
  };
}

async function removeAllEffectiveMembers(
  organizationId: string,
): Promise<void> {
  const { memberGroupId, stateHash } =
    await loadCurrentMemberGroupState(organizationId);
  await db
    .delete(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, "group"),
        eq(principalMembershipProjection.principalId, memberGroupId),
        eq(principalMembershipProjection.stateHash, stateHash),
      ),
    );
}

test("inline checkout charges the chosen plan at quantity one", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const member = createTestUser();
  await registerUser(member);
  await addEffectiveOrganizationMember({
    actor: admin,
    organizationId,
    userId: member.userId,
  });

  // The pre-subscription ledger can be stale or uninitialized. Checkout must
  // check the chosen plan against the signed Members group instead, and a
  // buyer may choose more capacity than the two members need.
  await db
    .update(organizationBilling)
    .set({ seatCount: 99 })
    .where(eq(organizationBilling.organizationId, organizationId));

  let subscriptionBody: string | null = null;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/prices/price_team_10")) {
      return Response.json({
        active: true,
        currency: "usd",
        id: "price_team_10",
        product: { active: true, id: "prod_sync" },
        recurring: { interval: "month", interval_count: 1 },
        unit_amount: 2_000,
      });
    }
    if (path.endsWith("/customers/search")) {
      return Response.json({ data: [] });
    }
    if (path.endsWith("/customers")) {
      return Response.json({ id: "cus_org" });
    }
    if (path.endsWith("/subscriptions/search")) {
      return Response.json({ data: [], has_more: false });
    }
    if (
      (path.endsWith("/subscriptions") ||
        path.endsWith("/checkout/sessions")) &&
      init?.method !== "POST"
    ) {
      return Response.json({ data: [], has_more: false });
    }
    if (path.endsWith("/subscriptions")) {
      subscriptionBody = String(init?.body ?? "");
      return Response.json({
        id: "sub_org",
        latest_invoice: {
          payment_intent: { client_secret: "pi_secret" },
        },
      });
    }
    throw new Error(`Unexpected Stripe request: ${path}`);
  }) as typeof fetch;

  const intent = await createStripeCheckout(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    "price_team_10",
    {
      stripe: { env: STRIPE_ENV, fetchImpl },
      revenueCat: { env: REVENUECAT_ENV },
    },
  );

  expect(intent).toEqual({
    subscriptionId: "sub_org",
    clientSecret: "pi_secret",
  });
  invariant(subscriptionBody, "expected Stripe subscription create body");
  expect(new URLSearchParams(subscriptionBody).get("items[0][quantity]")).toBe(
    "1",
  );
  expect(new URLSearchParams(subscriptionBody).get("items[0][price]")).toBe(
    "price_team_10",
  );
});

test("hosted checkout charges the chosen plan at quantity one", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const member = createTestUser();
  await registerUser(member);
  await addEffectiveOrganizationMember({
    actor: admin,
    organizationId,
    userId: member.userId,
  });

  let checkoutBody: string | null = null;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/prices/price_team_5")) {
      return Response.json({
        active: true,
        currency: "usd",
        id: "price_team_5",
        product: { active: true, id: "prod_sync" },
        recurring: { interval: "month", interval_count: 1 },
        unit_amount: 1_000,
      });
    }
    if (path.endsWith("/subscriptions/search")) {
      return Response.json({ data: [], has_more: false });
    }
    if (path.endsWith("/customers/search")) {
      return Response.json({ data: [] });
    }
    if (path.endsWith("/customers")) {
      return Response.json({ id: "cus_org" });
    }
    if (path.endsWith("/checkout/sessions") && init?.method === "POST") {
      checkoutBody = String(init?.body ?? "");
      return Response.json({
        id: "cs_org",
        url: "https://checkout.stripe.com/pay/cs_org",
      });
    }
    if (
      path.endsWith("/checkout/sessions") ||
      path.endsWith("/subscriptions")
    ) {
      return Response.json({ data: [], has_more: false });
    }
    throw new Error(`Unexpected Stripe request: ${path}`);
  }) as typeof fetch;

  const url = await createStripeCheckoutSession(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { priceId: "price_team_5", returnUrl: "https://app.example/billing" },
    {
      stripe: { env: STRIPE_ENV, fetchImpl },
      revenueCat: { env: REVENUECAT_ENV },
    },
  );

  expect(url).toBe("https://checkout.stripe.com/pay/cs_org");
  invariant(checkoutBody, "expected Stripe Checkout create body");
  expect(new URLSearchParams(checkoutBody).get("line_items[0][quantity]")).toBe(
    "1",
  );
  expect(new URLSearchParams(checkoutBody).get("line_items[0][price]")).toBe(
    "price_team_5",
  );
});

test("checkout rejects a tampered Members policy before contacting Stripe", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  await removeAllEffectiveMembers(organizationId);
  let requestCount = 0;
  const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
    requestCount += 1;
    return Response.json({});
  }) as typeof fetch;

  await expect(
    createStripeCheckout(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      "price_sync",
      {
        stripe: { env: STRIPE_ENV, fetchImpl },
        revenueCat: { env: REVENUECAT_ENV },
      },
    ),
  ).rejects.toMatchObject({
    message: "Organization access policy failed integrity verification",
    status: 409,
  });
  expect(requestCount).toBe(0);
});
