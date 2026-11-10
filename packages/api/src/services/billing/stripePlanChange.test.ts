import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBillingSeatEvents,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { registerUser } from "../../../test/helpers/registerUser";
import { addEffectiveOrganizationMember } from "../../../test/helpers/revenuecatWebhook";
import {
  readPlanState as readState,
  subscribedOrganization,
} from "../../../test/helpers/stripePlanChangeFixtures";
import { resolvePendingStripeSeatCount } from "../../workflows/billing/stripePlanChange";

test("an upgrade is charged now and its capacity applies once paid", async () => {
  const { change, organizationId, stripe } = await subscribedOrganization({
    seatCount: 1,
  });
  const fake = stripe();

  expect(await change("price_team_5", fake)).toBe("upgraded");

  const [write] = fake.writes;
  expect(write?.path).toBe("/v1/subscriptions/sub_plan");
  expect(write?.form.get("items[0][price]")).toBe("price_team_5");
  expect(write?.form.get("proration_behavior")).toBe("always_invoice");
  expect(write?.form.get("payment_behavior")).toBe("pending_if_incomplete");
  expect(await readState(organizationId)).toMatchObject({
    billing: { providerProductId: "price_team_5", seatCount: 5 },
    seats: {
      appliedPaidCapacity: 5,
      desiredRenewalQuantity: 5,
      leaseId: null,
      priceId: "price_team_5",
    },
  });
  const events = await db
    .select({ eventType: organizationBillingSeatEvents.eventType })
    .from(organizationBillingSeatEvents)
    .where(eq(organizationBillingSeatEvents.organizationId, organizationId));
  expect(events.map(({ eventType }) => eventType)).toContain(
    "licensed_seat_count_increased",
  );
});

test("a declined upgrade voids its invoice and changes nothing", async () => {
  const { change, organizationId, stripe } = await subscribedOrganization({
    seatCount: 1,
  });
  const fake = stripe(true);

  await expect(change("price_team_10", fake)).rejects.toMatchObject({
    code: "billing_plan_change_payment_failed",
    status: 409,
  });

  expect(fake.voids).toEqual(["in_upgrade"]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { providerProductId: "price_sync", seatCount: 1 },
    seats: { desiredRenewalQuantity: 1, leaseId: null, priceId: "price_sync" },
  });
});

test("a declined upgrade after a scheduled downgrade leaves Stripe at the smaller plan", async () => {
  // Team 5 renews at Solo, and Stripe's item is already at Solo.
  const { change, stripe } = await subscribedOrganization({
    itemSeatCount: 1,
    renewalSeatCount: 1,
    seatCount: 5,
  });
  const fake = stripe(true);

  await expect(change("price_team_10", fake)).rejects.toMatchObject({
    code: "billing_plan_change_payment_failed",
  });

  // The paid Price restored for the charge is written back to Solo before
  // the answer, so the renewal invoice still charges Solo.
  expect(
    fake.writes.map(({ form, path }) => [
      path,
      form.get("price") ?? form.get("items[0][price]"),
      form.get("proration_behavior"),
    ]),
  ).toEqual([
    ["/v1/subscription_items/si_plan", "price_team_5", "none"],
    ["/v1/subscriptions/sub_plan", "price_team_10", "always_invoice"],
    ["/v1/invoices/in_upgrade/void", null, null],
    ["/v1/subscription_items/si_plan", "price_sync", "none"],
  ]);
});

test("a downgrade is scheduled for renewal and keeps the paid capacity", async () => {
  const { change, organizationId, stripe } = await subscribedOrganization({
    seatCount: 5,
  });
  const fake = stripe();

  expect(await change("price_sync", fake)).toBe("scheduled");

  // Answered only once Stripe renews at Solo: its Price is written without
  // proration, so nothing is charged or credited now.
  const writes = () =>
    fake.writes.map(({ form, path }) => [
      path,
      form.get("price"),
      form.get("proration_behavior"),
    ]);
  expect(writes()).toEqual([
    ["/v1/subscription_items/si_plan", "price_sync", "none"],
  ]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 5 },
    seats: {
      appliedPaidCapacity: 5,
      desiredRenewalQuantity: 1,
      leaseId: null,
      priceId: "price_sync",
    },
  });
  expect(
    await resolvePendingStripeSeatCount(db, organizationId, {
      seatCount: 5,
      status: "active",
    }),
  ).toBe(1);

  // Choosing the current plan again cancels the scheduled change.
  expect(await change("price_team_5", fake)).toBe("kept");
  expect(writes().at(-1)).toEqual([
    "/v1/subscription_items/si_plan",
    "price_team_5",
    "none",
  ]);
  expect(await readState(organizationId)).toMatchObject({
    seats: { desiredRenewalQuantity: 5, priceId: "price_team_5" },
  });
});

test("a downgrade whose Stripe write failed is not scheduled and blocks a race", async () => {
  const { change, organizationId, stripe } = await subscribedOrganization({
    seatCount: 5,
  });
  const fake = stripe();
  const failing = (async (request: RequestInfo | URL, init?: RequestInit) =>
    String(request).includes("/v1/subscription_items/")
      ? new Response("unavailable", { status: 500 })
      : fake.fetchImpl(request, init)) as typeof fetch;

  await expect(
    change("price_sync", { ...fake, fetchImpl: failing }),
  ).rejects.toThrow();
  // The write may still apply in Stripe, so its lease is held until it
  // lapses: a newer choice waits rather than racing it.
  expect(await readState(organizationId)).toMatchObject({
    seats: { desiredRenewalQuantity: 5, leaseId: expect.any(String) },
  });
  await expect(change("price_team_5", fake)).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
  });
  expect(fake.writes).toEqual([]);
});

test("a plan smaller than the roster is refused until members are removed", async () => {
  const { admin, change, organizationId } = await subscribedOrganization({
    seatCount: 5,
  });
  const member = createTestUser();
  await registerUser(member);
  await addEffectiveOrganizationMember({
    actor: admin,
    organizationId,
    userId: member.userId,
  });

  await expect(change("price_sync")).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
    status: 409,
  });
  expect(await readState(organizationId)).toMatchObject({
    seats: { desiredRenewalQuantity: 5 },
  });
});

test("an upgrade after a scheduled downgrade is charged from the paid plan", async () => {
  // The worker already lowered the item to Solo for renewal; Stripe would
  // prorate from Solo, though Team 5 was paid for this period.
  const { change, organizationId, stripe } = await subscribedOrganization({
    itemSeatCount: 1,
    renewalSeatCount: 1,
    seatCount: 5,
  });
  const fake = stripe();

  expect(await change("price_team_10", fake)).toBe("upgraded");

  expect(
    fake.writes.map(({ form, path }) => [
      path,
      form.get("price") ?? form.get("items[0][price]"),
      form.get("proration_behavior"),
    ]),
  ).toEqual([
    ["/v1/subscription_items/si_plan", "price_team_5", "none"],
    ["/v1/subscriptions/sub_plan", "price_team_10", "always_invoice"],
  ]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 10 },
    seats: { desiredRenewalQuantity: 10, priceId: "price_team_10" },
  });
});

test("a plan change still being applied refuses another", async () => {
  const { change, organizationId } = await subscribedOrganization({
    seatCount: 1,
  });
  await db
    .update(organizationBillingStripeSeats)
    .set({
      leaseExpiresAt: new Date(Date.now() + 60_000),
      leaseId: "plan:other",
    })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));

  await expect(change("price_team_5")).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
    status: 409,
  });
});

test("a Stripe subscription quarantined under native ownership cannot change", async () => {
  const { change, organizationId, stripe } = await subscribedOrganization({
    seatCount: 1,
  });
  // A native store took ownership; the retained Stripe identity lost its
  // Price and owns no capacity.
  await db
    .update(organizationBillingStripeSeats)
    .set({ priceId: null })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  const fake = stripe();

  await expect(change("price_team_5", fake)).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
    status: 409,
  });
  expect(fake.writes).toEqual([]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 1 },
  });
});

test("a choice made against a plan that has since changed is refused", async () => {
  // The admin chose Team 5 as a downgrade from Team 10, but the subscription
  // renewed into Solo meanwhile: Team 5 would now be a charge.
  const { change, organizationId, stripe } = await subscribedOrganization({
    seatCount: 1,
  });
  const fake = stripe();

  await expect(change("price_team_5", fake, 10)).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
    status: 409,
  });
  expect(fake.writes).toEqual([]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 1 },
    seats: { desiredRenewalQuantity: 1, leaseId: null },
  });
});
