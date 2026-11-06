import { expect, test } from "bun:test";
import {
  STRIPE_PAYLOAD_ENV as ENV,
  recordingStripeFetch as fakeFetch,
} from "../../test/helpers/stripePayloadFetch";
import { findOrCreateCustomer } from "./stripeCustomer";

test("customer lookup reuses an existing metadata match", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { data: [{ id: "cus_existing" }] } },
  ]);
  const id = await findOrCreateCustomer(
    { userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );

  expect(id).toBe("cus_existing");
  expect(requests).toHaveLength(1);
  // Customers are scoped per (user, org): one pooled customer would let one
  // org's Billing Portal expose another org's subscription.
  expect(requests[0]?.url).toContain("/v1/customers/search");
  expect(decodeURIComponent(requests[0]?.url ?? "")).toContain("org-1");
});

test("customer lookup creates one with userId metadata when none exists", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { data: [] } },
    { body: { id: "cus_new" } },
  ]);
  const id = await findOrCreateCustomer(
    { userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );

  expect(id).toBe("cus_new");
  expect(requests[1]?.method).toBe("POST");
  expect(requests[1]?.body).toContain(
    `${encodeURIComponent("metadata[userId]")}=user-1`,
  );
  expect(requests[1]?.body).toContain(
    `${encodeURIComponent("metadata[orgId]")}=org-1`,
  );
});

test("customer creation is idempotency-keyed per user", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { data: [] } },
    { body: { id: "cus_new" } },
  ]);
  await findOrCreateCustomer(
    { userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );
  expect(requests[1]?.headers.get("Idempotency-Key")).toBe(
    "sync-customer:user-1:org-1",
  );
});
