import { beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  organizationRosterEntries,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  RootOrganizationDetailResponseSchema,
  RootOrganizationIdentitiesResponseSchema,
  RootOrganizationsResponseSchema,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  clearBillingHistory,
  insertInvoiceEvent,
  insertSeatEvent,
  registerAndAuthenticate,
} from "../../../test/helpers/organizationBillingHistory";
import { routeApp } from "../../routeApp";

const root = createTestUser();
const member = createTestUser();
let organizationId: string;
let rootOrganizationId: string;
const missingId = "00000000-0000-4000-8000-000000000000";
const orgName = `Root Org 100%_${randomUUID()}`;
const headers = (token = root.token) => ({ Authorization: `Bearer ${token}` });
const request = (path: string) =>
  routeApp.request(path, { headers: headers() });

beforeAll(async () => {
  rootOrganizationId = await registerAndAuthenticate(root);
  organizationId = await registerAndAuthenticate(member);
  await db.update(users).set({ isRoot: true }).where(eq(users.id, root.userId));
  await db
    .update(organizations)
    .set({ name: orgName })
    .where(eq(organizations.id, organizationId));
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: "cus_root_test",
      seatCount: 5,
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .update(organizationBillingStripeSeats)
    .set({
      customerId: "cus_root_test",
      subscriptionId: "sub_root_test",
      priceId: "price_root_test",
      desiredPaidCapacity: 5,
      appliedPaidCapacity: 5,
      desiredRenewalQuantity: 3,
      observedQuantity: 5,
      lastInvoiceId: "in_root_test",
    })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await clearBillingHistory(organizationId);
  await insertSeatEvent({
    organizationId,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    eventType: "licensed_seat_count_increased",
    seatCount: 5,
    seatDelta: 2,
    activeSeatCount: 3,
    sourceId: "root-test",
    sourceType: "principal_state",
  });
  await insertInvoiceEvent({
    organizationId,
    invoiceId: "in_root_test",
    occurredAt: new Date("2026-08-02T00:00:00Z"),
    seatCount: 5,
  });
  await insertInvoiceEvent({
    organizationId: rootOrganizationId,
    invoiceId: "in_other_root_org",
    occurredAt: new Date("2026-08-03T00:00:00Z"),
    seatCount: 9,
  });
});

test("all organization routes enforce authentication and root standing", async () => {
  for (const path of [
    "/root/organizations",
    `/root/organizations/${organizationId}`,
    `/root/organizations/${organizationId}/identities`,
  ]) {
    expect((await routeApp.request(path)).status).toBe(401);
    expect(
      (await routeApp.request(path, { headers: headers(member.token) })).status,
    ).toBe(403);
  }
});

test("searches organization names literally and supports exact IDs", async () => {
  for (const search of [orgName.toUpperCase(), organizationId]) {
    const response = await request(
      `/root/organizations?search=${encodeURIComponent(search)}`,
    );
    expect(response.status).toBe(200);
    const page = RootOrganizationsResponseSchema.parse(await response.json());
    expect(page.organizations.map((org) => org.organizationId)).toEqual([
      organizationId,
    ]);
    expect(page.organizations[0]?.billingStatus).toBe("trialing");
  }
  const response = await request(
    `/root/organizations?search=${encodeURIComponent(orgName.replace("%_", ""))}`,
  );
  expect((await response.json()).organizations).toEqual([]);
});

test("pages organizations without repeats or gaps", async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 500; page += 1) {
    const response = await request(
      `/root/organizations?limit=1${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
    );
    expect(response.status).toBe(200);
    const data = RootOrganizationsResponseSchema.parse(await response.json());
    expect(data.organizations.length).toBeLessThanOrEqual(1);
    seen.push(...data.organizations.map((org) => org.organizationId));
    cursor = data.nextCursor;
    if (cursor === null) break;
  }
  expect(cursor).toBeNull();
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen).toContain(organizationId);
  expect(seen).toContain(rootOrganizationId);
});

test("an operator outside the org reads detailed billing and scoped history without writes", async () => {
  const before = await db
    .select()
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(
    (await request(`/organizations/${organizationId}/billing/history`)).status,
  ).toBe(403);
  const response = await request(`/root/organizations/${organizationId}`);
  expect(response.status).toBe(200);
  const detail = RootOrganizationDetailResponseSchema.parse(
    await response.json(),
  );
  expect(detail.organization.name).toBe(orgName);
  expect(detail.billing?.providerCustomerId).toBe("cus_root_test");
  expect(detail.billing?.seatCount).toBe(5);
  expect(detail.stripe).toMatchObject({
    subscriptionId: "sub_root_test",
    priceId: "price_root_test",
    desiredRenewalQuantity: 3,
    lastInvoiceId: "in_root_test",
  });
  expect(detail.history.map((entry) => entry.category)).toEqual([
    "invoice",
    "seat",
  ]);
  expect(detail.history[0]).toMatchObject({
    invoiceId: "in_root_test",
    seatCount: 5,
    totalAmount: 6000,
    totalCurrency: "usd",
  });
  expect(detail.history[1]?.seatDelta).toBe(2);
  expect(
    await db
      .select()
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, organizationId)),
  ).toEqual(before);
});

test("rosters include disabled identities, page them, and bind cursors to the org", async () => {
  await db.insert(organizationRosterEntries).values({
    organizationId,
    userId: root.userId,
    status: "disabled",
    disabledAt: new Date("2026-08-01T00:00:00Z"),
  });
  const response = await request(
    `/root/organizations/${organizationId}/identities?limit=1`,
  );
  expect(response.status).toBe(200);
  const first = RootOrganizationIdentitiesResponseSchema.parse(
    await response.json(),
  );
  expect(first.identities).toHaveLength(1);
  expect(first.nextCursor).not.toBeNull();
  const query = `limit=1&cursor=${encodeURIComponent(first.nextCursor ?? "")}`;
  const second = RootOrganizationIdentitiesResponseSchema.parse(
    await (
      await request(`/root/organizations/${organizationId}/identities?${query}`)
    ).json(),
  );
  expect(second.nextCursor).toBeNull();
  const roster = [...first.identities, ...second.identities];
  expect(new Set(roster.map((row) => row.identity.userId))).toEqual(
    new Set([root.userId, member.userId]),
  );
  expect(
    roster.find((row) => row.identity.userId === root.userId)?.roster.status,
  ).toBe("disabled");
  expect(
    roster.find((row) => row.identity.userId === member.userId)?.identity
      .signingKeyFingerprint,
  ).toBe(member.fingerprint);
  expect(
    (
      await request(
        `/root/organizations/${rootOrganizationId}/identities?${query}`,
      )
    ).status,
  ).toBe(400);
});

test("missing billing is distinct from a missing organization", async () => {
  const [source] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!source) throw new Error("Expected organization fixture");
  const id = randomUUID();
  await db
    .insert(organizations)
    .values({ ...source, id, name: "No billing record" });
  const response = await request(`/root/organizations/${id}`);
  expect(response.status).toBe(200);
  expect(
    RootOrganizationDetailResponseSchema.parse(await response.json()),
  ).toMatchObject({ billing: null, stripe: null, history: [] });
  expect((await request(`/root/organizations/${id}/identities`)).status).toBe(
    200,
  );
  for (const suffix of ["", "/identities"]) {
    expect(
      (await request(`/root/organizations/${missingId}${suffix}`)).status,
    ).toBe(404);
    expect(
      (await request(`/root/organizations/not-a-uuid${suffix}`)).status,
    ).toBe(400);
  }
});

test("invalid queries fail without querying unbounded listings", async () => {
  for (const query of [
    "limit=0",
    "limit=201",
    "limit=abc",
    "cursor=bad",
    `search=${"x".repeat(201)}`,
  ]) {
    expect((await request(`/root/organizations?${query}`)).status).toBe(400);
  }
  expect(
    (await request(`/root/organizations/${organizationId}/identities?limit=0`))
      .status,
  ).toBe(400);
});
