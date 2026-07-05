import { expect, test } from "bun:test";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { LAPSED_BILLING_PURGE_GRACE_MS } from "./organizationBilling";
import {
  classifyRevenueCatEvent,
  readRevenueCatWebhookAuthToken,
  resolveOrganizationIdFromEvent,
} from "./revenuecatWebhook";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function makeEvent(
  overrides: Partial<RevenueCatWebhookEvent> = {},
): RevenueCatWebhookEvent {
  return {
    id: "event-1",
    type: "INITIAL_PURCHASE",
    app_user_id: "user-1",
    event_timestamp_ms: 1_000,
    expiration_at_ms: 2_000,
    entitlement_ids: ["sync"],
    subscriber_attributes: { orgId: { value: ORG_ID } },
    ...overrides,
  };
}

test("a purchase event classifies as a grant that activates sync", () => {
  const transition = classifyRevenueCatEvent(makeEvent());
  expect(transition.kind).toBe("grant");
  if (transition.kind !== "grant") {
    throw new Error("expected a grant");
  }
  expect(transition.fields.status).toBe("active");
  expect(transition.fields.provider).toBe("revenuecat");
  expect(transition.fields.providerCustomerId).toBe("user-1");
  expect(transition.fields.entitlementId).toBe("sync");
  expect(transition.fields.currentPeriodEndsAt).toEqual(new Date(2_000));
  expect(transition.fields.trialEndsAt).toBeNull();
  expect(transition.fields.disabledAt).toBeNull();
  expect(transition.fields.purgeAfter).toBeNull();
});

test("a grant falls back to the deprecated single entitlement id", () => {
  const transition = classifyRevenueCatEvent({
    app_user_id: "user-1",
    entitlement_id: "legacy-sync",
    event_timestamp_ms: 1_000,
    expiration_at_ms: 2_000,
    id: "event-1",
    subscriber_attributes: { orgId: { value: ORG_ID } },
    type: "INITIAL_PURCHASE",
  });
  expect(transition.kind === "grant" && transition.fields.entitlementId).toBe(
    "legacy-sync",
  );
});

test("a grant without an expiration has a null period end", () => {
  const transition = classifyRevenueCatEvent(
    makeEvent({ expiration_at_ms: null }),
  );
  expect(
    transition.kind === "grant" && transition.fields.currentPeriodEndsAt,
  ).toBeNull();
});

test("an expiration event classifies as a revoke that disables sync", () => {
  const now = new Date(10_000);
  const transition = classifyRevenueCatEvent(
    makeEvent({ type: "EXPIRATION" }),
    now,
  );
  expect(transition.kind).toBe("revoke");
  if (transition.kind !== "revoke") {
    throw new Error("expected a revoke");
  }
  expect(transition.fields.status).toBe("disabled");
  expect(transition.fields.disabledAt).toEqual(now);
  expect(transition.fields.purgeAfter).toEqual(
    new Date(now.getTime() + LAPSED_BILLING_PURGE_GRACE_MS),
  );
});

test("a cancellation is ignored because the entitlement stays active", () => {
  expect(
    classifyRevenueCatEvent(makeEvent({ type: "CANCELLATION" })).kind,
  ).toBe("ignore");
});

test("an unknown event type is ignored", () => {
  expect(
    classifyRevenueCatEvent(makeEvent({ type: "SOMETHING_NEW" })).kind,
  ).toBe("ignore");
});

test("resolveOrganizationIdFromEvent reads the orgId subscriber attribute", () => {
  expect(resolveOrganizationIdFromEvent(makeEvent())).toBe(ORG_ID);
});

test("resolveOrganizationIdFromEvent rejects a missing or malformed org id", () => {
  expect(
    resolveOrganizationIdFromEvent({
      app_user_id: "user-1",
      event_timestamp_ms: 1_000,
      id: "event-1",
      type: "INITIAL_PURCHASE",
    }),
  ).toBeNull();
  expect(
    resolveOrganizationIdFromEvent(
      makeEvent({ subscriber_attributes: { orgId: { value: "not-a-uuid" } } }),
    ),
  ).toBeNull();
  expect(
    resolveOrganizationIdFromEvent(
      makeEvent({ subscriber_attributes: { orgId: { value: null } } }),
    ),
  ).toBeNull();
});

test("readRevenueCatWebhookAuthToken reads and trims the configured secret", () => {
  expect(
    readRevenueCatWebhookAuthToken({
      REVENUECAT_WEBHOOK_AUTH_HEADER: " s3cret ",
    }),
  ).toBe("s3cret");
  expect(readRevenueCatWebhookAuthToken({})).toBeNull();
  expect(
    readRevenueCatWebhookAuthToken({ REVENUECAT_WEBHOOK_AUTH_HEADER: "  " }),
  ).toBeNull();
});
