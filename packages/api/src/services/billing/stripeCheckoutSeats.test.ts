import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizations,
  principalMembershipProjection,
  principalStates,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { and, desc, eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { getDefaultApiServiceRuntime } from "../runtime";
import {
  createStripeCheckout,
  createStripeCheckoutSession,
} from "./stripeCheckout";

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
  STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
  STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
};
const REVENUECAT_ENV = {
  REVENUECAT_V2_SECRET_KEY: "sk_rc",
  REVENUECAT_PROJECT_ID: "proj_1",
  REVENUECAT_STRIPE_PUBLIC_API_KEY: "strp_pub",
};

async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user row");
  return row.organizationId;
}

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

async function addEffectiveMember(
  organizationId: string,
  userId: string,
): Promise<void> {
  const { memberGroupId, stateHash } =
    await loadCurrentMemberGroupState(organizationId);
  await db.insert(principalMembershipProjection).values({
    principalType: "group",
    principalId: memberGroupId,
    stateHash,
    memberPrincipalType: "user",
    memberPrincipalId: userId,
    role: "member",
  });
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

test("inline checkout selects the current membership tier at quantity one", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const member = createTestUser();
  await registerUser(member);
  await addEffectiveMember(organizationId, member.userId);

  // The pre-subscription ledger can be stale or uninitialized. Checkout must
  // derive quantity from the signed Members group instead of trusting it.
  await db
    .update(organizationBilling)
    .set({ seatCount: 99 })
    .where(eq(organizationBilling.organizationId, organizationId));

  let subscriptionBody: string | null = null;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/customers/search")) {
      return Response.json({ data: [] });
    }
    if (path.endsWith("/customers")) {
      return Response.json({ id: "cus_org" });
    }
    if (path.endsWith("/subscriptions/search")) {
      return Response.json({ data: [] });
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
    "price_team_5",
  );
});

test("hosted checkout selects the current membership tier at quantity one", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const member = createTestUser();
  await registerUser(member);
  await addEffectiveMember(organizationId, member.userId);

  let checkoutBody: string | null = null;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/subscriptions/search")) {
      return Response.json({ data: [] });
    }
    if (path.endsWith("/customers/search")) {
      return Response.json({ data: [] });
    }
    if (path.endsWith("/customers")) {
      return Response.json({ id: "cus_org" });
    }
    if (path.endsWith("/checkout/sessions")) {
      checkoutBody = String(init?.body ?? "");
      return Response.json({ url: "https://checkout.stripe.com/pay/cs_org" });
    }
    throw new Error(`Unexpected Stripe request: ${path}`);
  }) as typeof fetch;

  const url = await createStripeCheckoutSession(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    "https://app.example/billing",
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

test("checkout rejects a malformed organization with no effective members", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
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
      {
        stripe: { env: STRIPE_ENV, fetchImpl },
        revenueCat: { env: REVENUECAT_ENV },
      },
    ),
  ).rejects.toMatchObject({
    message: "The organization has no active members",
    status: 409,
  });
  expect(requestCount).toBe(0);
});
