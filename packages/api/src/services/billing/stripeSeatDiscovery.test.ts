import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  organizations,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import { eq, inArray } from "drizzle-orm";
import { organizationSeatPeriodKey } from "../../billing/organizationBilling";
import {
  claimOrganizationStripeSeatDiscovery,
  failOrganizationStripeSeatDiscovery,
  seedLegacyOrganizationStripeSeats,
} from "../../workflows/billing/stripeSeatDiscovery";
import { getDefaultApiServiceRuntime } from "../runtime";
import { runStripeSeatSynchronization } from "./stripeSeatSync";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const PERIOD_START = new Date("2026-07-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-08-01T00:00:00.000Z");
const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_PRICE_ID: "price_sync",
};

function paidPeriodKey(): string {
  return organizationSeatPeriodKey({
    currentPeriodEndsAt: PERIOD_END,
    currentPeriodStartsAt: PERIOD_START,
    status: "active",
    trialEndsAt: null,
  });
}

async function insertLegacyBilling(input: {
  readonly activeMemberCount?: number;
  readonly organizationId: string;
  readonly providerSubscriptionId: string;
  readonly seatCount: number;
  readonly status: "active" | "trialing";
}): Promise<void> {
  const memberGroupId = crypto.randomUUID();
  await db.insert(organizations).values({
    adminGroupId: crypto.randomUUID(),
    id: input.organizationId,
    memberGroupId,
    name: "Legacy billing organization",
  });
  await db.insert(organizationBilling).values({
    currentPeriodEndsAt: input.status === "active" ? PERIOD_END : null,
    currentPeriodStartsAt: input.status === "active" ? PERIOD_START : null,
    organizationId: input.organizationId,
    provider: "revenuecat",
    providerSubscriptionId: input.providerSubscriptionId,
    seatCount: input.seatCount,
    seatPeriodKey: input.status === "active" ? paidPeriodKey() : "trial-period",
    status: input.status,
    trialEndsAt:
      input.status === "trialing" ? new Date("2026-07-31T00:00:00.000Z") : null,
  });

  const activeMemberCount = input.activeMemberCount ?? 0;
  if (activeMemberCount === 0) {
    return;
  }
  const stateHash = `state-${input.organizationId}`;
  const userIds = Array.from({ length: activeMemberCount }, () =>
    crypto.randomUUID(),
  );
  await db.insert(principalStates).values({
    encapsulationPublicKey: "encapsulation-public-key",
    keyEpoch: 1,
    keyFingerprint: "key-fingerprint",
    memberCount: userIds.length,
    memberEnvelopesRoot: "member-envelopes-root",
    membershipMode: "projection",
    membershipRoot: "membership-root",
    payloadCiphertextHash: "payload-ciphertext-hash",
    principalId: memberGroupId,
    principalType: "group",
    projectionRoot: "projection-root",
    signature: "signature",
    signedAt: NOW,
    signerUserId: userIds[0] ?? crypto.randomUUID(),
    signerUserKeyFingerprint: "signer-key-fingerprint",
    stateHash,
    version: 1,
  });
  await db.insert(principalMembershipProjection).values(
    userIds.map((userId) => ({
      memberPrincipalId: userId,
      memberPrincipalType: "user" as const,
      principalId: memberGroupId,
      principalType: "group" as const,
      role: "member" as const,
      stateHash,
    })),
  );
}

test("discovers an active legacy web subscription and prorates its seats", async () => {
  const organizationId = crypto.randomUUID();
  const mobileOrganizationId = crypto.randomUUID();
  const trialOrganizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const subscriptionItemId = `si_${organizationId}`;
  await insertLegacyBilling({
    activeMemberCount: 2,
    organizationId,
    providerSubscriptionId: `si_legacy_${organizationId}`,
    seatCount: 2,
    status: "active",
  });
  await insertLegacyBilling({
    organizationId: mobileOrganizationId,
    providerSubscriptionId: "1000000123456789",
    seatCount: 2,
    status: "active",
  });
  await insertLegacyBilling({
    organizationId: trialOrganizationId,
    providerSubscriptionId: `si_trial_${trialOrganizationId}`,
    seatCount: 2,
    status: "trialing",
  });

  const requests: Array<{ body: string; method: string; url: string }> = [];
  const fetchImpl = (async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = String(request);
    const method = init?.method ?? "GET";
    requests.push({ body: String(init?.body ?? ""), method, url });
    if (url.includes("/v1/subscriptions/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              customer: "cus_legacy",
              id: subscriptionId,
              metadata: { orgId: organizationId },
              status: "active",
            },
          ],
        }),
      );
    }
    if (method === "GET") {
      return new Response(
        JSON.stringify({
          customer: "cus_legacy",
          current_period_end: PERIOD_END.getTime() / 1000,
          current_period_start: PERIOD_START.getTime() / 1000,
          id: subscriptionId,
          items: {
            data: [
              {
                id: subscriptionItemId,
                price: { id: "price_sync" },
                quantity: 1,
              },
            ],
          },
          metadata: { orgId: organizationId, userId: "user-1" },
          status: "active",
        }),
      );
    }
    return new Response("{}");
  }) as typeof fetch;

  expect(
    await runStripeSeatSynchronization(
      getDefaultApiServiceRuntime(),
      { limit: 2, now: NOW },
      { stripe: { env: STRIPE_ENV, fetchImpl } },
    ),
  ).toEqual({ attempted: 2, failed: 0, synced: 1 });

  const rows = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(
      inArray(organizationBillingStripeSeats.organizationId, [
        organizationId,
        mobileOrganizationId,
        trialOrganizationId,
      ]),
    );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    appliedPaidCapacity: 2,
    desiredPaidCapacity: 2,
    desiredRenewalQuantity: 2,
    observedQuantity: 2,
    organizationId,
    subscriptionId,
    subscriptionItemId,
  });
  expect(
    requests
      .filter((request) => request.method === "POST")
      .map((request) => request.body),
  ).toContain("quantity=2&proration_behavior=create_prorations");
});

test("legacy discovery preserves paid capacity but renews effective Members", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const subscriptionItemId = `si_${organizationId}`;
  await insertLegacyBilling({
    activeMemberCount: 2,
    organizationId,
    providerSubscriptionId: `si_legacy_${organizationId}`,
    seatCount: 5,
    status: "active",
  });

  const requests: Array<{ body: string; method: string; url: string }> = [];
  const fetchImpl = (async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = String(request);
    const method = init?.method ?? "GET";
    requests.push({ body: String(init?.body ?? ""), method, url });
    if (url.includes("/v1/subscriptions/search")) {
      return Response.json({
        data: [
          {
            customer: "cus_high_water",
            id: subscriptionId,
            metadata: { orgId: organizationId },
            status: "active",
          },
        ],
      });
    }
    if (method === "GET") {
      return Response.json({
        customer: "cus_high_water",
        current_period_end: PERIOD_END.getTime() / 1000,
        current_period_start: PERIOD_START.getTime() / 1000,
        id: subscriptionId,
        items: {
          data: [
            {
              id: subscriptionItemId,
              price: { id: "price_sync" },
              quantity: 5,
            },
          ],
        },
        metadata: { orgId: organizationId, userId: "user-1" },
        status: "active",
      });
    }
    return Response.json({});
  }) as typeof fetch;

  expect(
    await runStripeSeatSynchronization(
      getDefaultApiServiceRuntime(),
      { limit: 2, now: NOW },
      { stripe: { env: STRIPE_ENV, fetchImpl } },
    ),
  ).toEqual({ attempted: 2, failed: 0, synced: 1 });

  const [state] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(state).toMatchObject({
    appliedPaidCapacity: 5,
    desiredPaidCapacity: 5,
    desiredRenewalQuantity: 2,
    observedQuantity: 2,
  });
  expect(
    requests
      .filter((request) => request.method === "POST")
      .map((request) => request.body),
  ).toEqual(["quantity=2&proration_behavior=none"]);
});

test("legacy discovery seeds at least one desired seat under a DB lease", async () => {
  const organizationId = crypto.randomUUID();
  await insertLegacyBilling({
    organizationId,
    providerSubscriptionId: `si_legacy_${organizationId}`,
    seatCount: 0,
    status: "active",
  });

  expect(await seedLegacyOrganizationStripeSeats(db, NOW)).toBe(1);
  const [state] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(state).toMatchObject({
    desiredPaidCapacity: 1,
    desiredRenewalQuantity: 1,
  });
  const claim = await claimOrganizationStripeSeatDiscovery(db, NOW);
  expect(claim?.organizationId).toBe(organizationId);
  expect(await claimOrganizationStripeSeatDiscovery(db, NOW)).toBeNull();
  if (claim) {
    await failOrganizationStripeSeatDiscovery({
      claim,
      error: "test cleanup",
      executor: db,
      now: NOW,
    });
  }
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db
    .delete(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
});
