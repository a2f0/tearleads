import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import { isOrganizationBillingResponse } from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  setTestOrganizationBillingExpiredTrial,
  setTestOrganizationBillingLocal,
} from "../../../test/helpers/organizationBilling";
import { registerUser } from "../../../test/helpers/registerUser";
import { addSyntheticEffectiveOrganizationMembers } from "../../../test/helpers/revenuecatWebhook";
import { routeApp } from "../../routeApp";
import { getOrganizationBillingManagementUrl } from "../../services/billing/organizationBilling";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

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

function authHeader(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${user.token}` };
}

test("an org admin reads local billing and starts a trial", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  // Test registration enables sync by default; this test exercises the
  // local -> trial transition, so start from the provisioned `local` state.
  await setTestOrganizationBillingLocal(organizationId);

  const readResponse = await routeApp.request(
    `/organizations/${organizationId}/billing`,
    { headers: authHeader(admin) },
  );
  expect(readResponse.status).toBe(200);
  const billing = await readResponse.json();
  invariant(
    isOrganizationBillingResponse(billing),
    "expected billing response",
  );
  expect(billing.status).toBe("local");
  expect(billing.activeMemberCount).toBe(1);
  expect(billing.trialEndsAt).toBeNull();

  const trialResponse = await routeApp.request(
    `/organizations/${organizationId}/billing/trial`,
    { headers: authHeader(admin), method: "POST" },
  );
  expect(trialResponse.status).toBe(200);
  const trialing = await trialResponse.json();
  invariant(
    isOrganizationBillingResponse(trialing),
    "expected billing response",
  );
  expect(trialing.status).toBe("trialing");
  expect(trialing.trialEndsAt).not.toBeNull();
  expect(trialing.seatCount).toBe(10);

  // Starting the trial again is idempotent, not an error.
  const trialAgain = await routeApp.request(
    `/organizations/${organizationId}/billing/trial`,
    { headers: authHeader(admin), method: "POST" },
  );
  expect(trialAgain.status).toBe(200);
  const stillTrialing = await trialAgain.json();
  invariant(
    isOrganizationBillingResponse(stillTrialing),
    "expected billing response",
  );
  expect(stillTrialing.status).toBe("trialing");
});

test("a free trial bounds an oversized roster to ten sync seats", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await addSyntheticEffectiveOrganizationMembers({
    actor: admin,
    count: 10,
    organizationId,
  });
  await setTestOrganizationBillingLocal(organizationId);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/trial`,
    { headers: authHeader(admin), method: "POST" },
  );

  expect(response.status).toBe(200);
  const billing = await response.json();
  invariant(
    isOrganizationBillingResponse(billing),
    "expected billing response",
  );
  expect(billing).toMatchObject({
    activeMemberCount: 11,
    assignedSeatCount: 10,
    currentUserHasSyncSeat: true,
    seatCount: 10,
    status: "trialing",
  });
});

test("reading an expired trial reports disabled without writing on the read path", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  // A `trialing` row whose trial has already lapsed, not yet flipped in the db.
  await setTestOrganizationBillingExpiredTrial(organizationId);

  const readResponse = await routeApp.request(
    `/organizations/${organizationId}/billing`,
    { headers: authHeader(admin) },
  );
  expect(readResponse.status).toBe(200);
  const billing = await readResponse.json();
  invariant(
    isOrganizationBillingResponse(billing),
    "expected billing response",
  );
  // The read surfaces the effective, in-memory expired state...
  expect(billing.status).toBe("disabled");

  // ...but must NOT persist it: reads run inside read transactions and a
  // write-on-read would poison a pg transaction on a read replica. The stored
  // row is still `trialing`; persisting the transition is the background sweep's
  // job.
  const [stored] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(stored, "expected stored billing row");
  expect(stored.status).toBe("trialing");
});

test("management identifies Stripe and native subscription ownership", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerProductId: "price_solo_test",
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));

  const stripeManagement = await getOrganizationBillingManagementUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: { STRIPE_SYNC_SOLO_PRICE_ID: "price_solo_test" } } },
  );
  expect(stripeManagement).toEqual({
    canCancelDirectly: true,
    managementUrl: null,
    subscriptionSource: "stripe",
  });

  await db
    .update(organizationBilling)
    .set({ status: "past_due" })
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(
    await getOrganizationBillingManagementUrl(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      { stripe: { env: { STRIPE_SYNC_SOLO_PRICE_ID: "price_solo_test" } } },
    ),
  ).toEqual({
    canCancelDirectly: true,
    managementUrl: null,
    subscriptionSource: "stripe",
  });

  await db
    .update(organizationBilling)
    .set({
      providerCustomerId: admin.userId,
      providerProductId: "sync_team_5_monthly",
      providerSubscriptionId: "native-sub-1",
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: null,
    subscriptionId: "sub_quarantined_native_takeover",
    subscriptionItemId: "si_quarantined_native_takeover",
  });
  const revenueCat = {
    env: {
      REVENUECAT_PROJECT_ID: "proj_test",
      REVENUECAT_V2_SECRET_KEY: "sk_test",
    },
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              gives_access: true,
              management_url: "https://apps.apple.com/account/subscriptions",
              store_subscription_identifier: "native-sub-1",
            },
          ],
        }),
      )) as unknown as typeof fetch,
  };
  const nativeManagement = await getOrganizationBillingManagementUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { revenueCat },
  );
  expect(nativeManagement).toEqual({
    canCancelDirectly: true,
    managementUrl: "https://apps.apple.com/account/subscriptions",
    subscriptionSource: "native",
  });

  await db
    .update(organizationBilling)
    .set({ status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const lapsedNativeManagement = await getOrganizationBillingManagementUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { revenueCat },
  );
  expect(lapsedNativeManagement).toEqual({
    canCancelDirectly: false,
    managementUrl: "https://apps.apple.com/account/subscriptions",
    subscriptionSource: "native",
  });

  await db
    .update(organizationBilling)
    .set({ providerProductId: "price_solo_test", status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const staleStripeManagement = await getOrganizationBillingManagementUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: { STRIPE_SYNC_SOLO_PRICE_ID: "price_solo_test" } } },
  );
  expect(staleStripeManagement).toEqual({
    canCancelDirectly: false,
    managementUrl: null,
    subscriptionSource: null,
  });

  await db
    .update(organizationBilling)
    .set({ providerProductId: "price_rotated", status: "active" })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: "price_rotated",
    subscriptionId: null,
    subscriptionItemId: "si_rotated",
  });
  const rotatedStripeManagement = await getOrganizationBillingManagementUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
  );
  expect(rotatedStripeManagement).toEqual({
    canCancelDirectly: true,
    managementUrl: null,
    subscriptionSource: "stripe",
  });
});

test("a non-member cannot read or change another org's billing", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticate(owner);
  const intruder = createTestUser();
  await registerAndAuthenticate(intruder);

  const readResponse = await routeApp.request(
    `/organizations/${organizationId}/billing`,
    { headers: authHeader(intruder) },
  );
  expect(readResponse.status).toBe(403);

  const trialResponse = await routeApp.request(
    `/organizations/${organizationId}/billing/trial`,
    { headers: authHeader(intruder), method: "POST" },
  );
  expect(trialResponse.status).toBe(403);

  const claimResponse = await routeApp.request(
    `/organizations/${organizationId}/billing/native/play_store/claim`,
    { headers: authHeader(intruder), method: "POST" },
  );
  expect(claimResponse.status).toBe(403);

  const invalidStoreResponse = await routeApp.request(
    `/organizations/${organizationId}/billing/native/stripe/claim`,
    { headers: authHeader(owner), method: "POST" },
  );
  expect(invalidStoreResponse.status).toBe(400);
});
