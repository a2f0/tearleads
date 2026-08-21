import { expect, test } from "bun:test";
import { organizationBillingAssignedSeatsRefinement } from "../organizationBillingRefinements";
import {
  OrganizationBillingHistoryResponseSchema,
  OrganizationBillingManagementUrlResponseSchema,
  OrganizationBillingResponseSchema,
} from "../response";
import { openApiDocument } from "./openApi";
import {
  claimNativeOrganizationSubscriptionOperation,
  getOrganizationBillingHistoryOperation,
  getOrganizationBillingManagementUrlOperation,
  getOrganizationBillingOperation,
  OrganizationBillingNativeClaimPathParamsSchema,
  OrganizationBillingPathParamsSchema,
  startOrganizationTrialOperation,
} from "./organizationBilling";
import { OrganizationPathParamsSchema } from "./organizations";

const organizationId = "11111111-1111-4111-8111-111111111111";

const billingResponse = {
  organizationId,
  activeMemberCount: 2,
  assignedSeatCount: 1,
  assignedUserIds: ["user-1"],
  currentUserHasSyncSeat: true,
  status: "active",
  trialEndsAt: null,
  provider: "revenuecat",
  currentPeriodStartsAt: "2026-07-01T00:00:00.000Z",
  currentPeriodEndsAt: "2026-08-01T00:00:00.000Z",
  seatCount: 1,
  pendingSeatCount: null,
  disabledAt: null,
  purgeAfter: null,
  futureBillingField: true,
};

const historyResponse = {
  organizationId,
  entries: [
    {
      id: "event-1",
      category: "lifecycle",
      provider: "revenuecat",
      environment: "production",
      eventType: "INITIAL_PURCHASE",
      outcome: "applied",
      occurredAt: "2026-07-01T00:00:00.000Z",
      productId: "sync_solo_monthly",
      transactionId: "transaction-1",
      invoiceId: null,
      subscriptionId: "subscription-1",
      billingReason: null,
      seatCount: 1,
      seatDelta: null,
      activeSeatCount: 1,
      priceId: null,
      unitAmount: 500,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      totalAmount: 500,
      totalCurrency: "usd",
      periodStartsAt: "2026-07-01T00:00:00.000Z",
      periodEndsAt: "2026-08-01T00:00:00.000Z",
      futureHistoryField: true,
    },
  ],
};

test("organization billing operations own their wire contracts", () => {
  expect(getOrganizationBillingOperation).toMatchObject({
    auth: "session",
    method: "GET",
    path: "/organizations/{organizationId}/billing",
    responses: { 200: OrganizationBillingResponseSchema },
  });
  expect(getOrganizationBillingHistoryOperation.responses[200]).toBe(
    OrganizationBillingHistoryResponseSchema,
  );
  expect(getOrganizationBillingManagementUrlOperation.responses[200]).toBe(
    OrganizationBillingManagementUrlResponseSchema,
  );
  expect(startOrganizationTrialOperation).toMatchObject({
    method: "POST",
    path: "/organizations/{organizationId}/billing/trial",
  });
  expect(claimNativeOrganizationSubscriptionOperation).toMatchObject({
    method: "POST",
    path: "/organizations/{organizationId}/billing/native/{store}/claim",
  });
});

test("organization billing operations document their handler failures", () => {
  expect(getOrganizationBillingOperation.failureStatuses).toEqual([
    400, 401, 403, 404, 500,
  ]);
  expect(getOrganizationBillingHistoryOperation.failureStatuses).toEqual([
    400, 401, 403, 404, 500,
  ]);
  expect(getOrganizationBillingManagementUrlOperation.failureStatuses).toEqual([
    400, 401, 403, 404, 500,
  ]);
  expect(startOrganizationTrialOperation.failureStatuses).toEqual([
    400, 401, 403, 404, 409, 500,
  ]);
  expect(claimNativeOrganizationSubscriptionOperation.failureStatuses).toEqual([
    400, 401, 403, 404, 409, 500, 503,
  ]);
});

test("organization billing path schemas preserve route compatibility", () => {
  expect(OrganizationBillingPathParamsSchema).toBe(
    OrganizationPathParamsSchema,
  );
  expect(
    OrganizationBillingNativeClaimPathParamsSchema.safeParse({
      organizationId,
      store: "play_store",
    }).success,
  ).toBe(true);
  expect(
    OrganizationBillingNativeClaimPathParamsSchema.safeParse({
      organizationId,
      store: "stripe",
    }).success,
  ).toBe(false);
  expect(
    OrganizationBillingNativeClaimPathParamsSchema.safeParse({
      organizationId: "invalid",
      store: "play_store",
    }).success,
  ).toBe(false);
});

test("billing response schemas preserve extensions and runtime identity", () => {
  const billingResult =
    OrganizationBillingResponseSchema.safeParse(billingResponse);
  expect(billingResult.success).toBe(true);
  if (billingResult.success) {
    expect(billingResult.data as unknown).toBe(billingResponse);
  }

  const historyResult =
    OrganizationBillingHistoryResponseSchema.safeParse(historyResponse);
  expect(historyResult.success).toBe(true);
  if (historyResult.success) {
    expect(historyResult.data as unknown).toBe(historyResponse);
  }
});

test("assigned seat cardinality remains an explicit runtime refinement", () => {
  expect(getOrganizationBillingOperation.runtimeRefinements).toEqual([
    organizationBillingAssignedSeatsRefinement,
  ]);
  expect(startOrganizationTrialOperation.runtimeRefinements).toEqual([
    organizationBillingAssignedSeatsRefinement,
  ]);
  expect(
    claimNativeOrganizationSubscriptionOperation.runtimeRefinements,
  ).toEqual([organizationBillingAssignedSeatsRefinement]);
  expect(
    OrganizationBillingResponseSchema.safeParse({
      ...billingResponse,
      assignedSeatCount: 2,
    }).success,
  ).toBe(false);
});

test("OpenAPI declares the assigned-seat runtime-only invariant", () => {
  for (const operation of [
    openApiDocument.paths["/organizations/{organizationId}/billing"]?.get,
    openApiDocument.paths[
      "/organizations/{organizationId}/billing/native/{store}/claim"
    ]?.post,
    openApiDocument.paths["/organizations/{organizationId}/billing/trial"]
      ?.post,
  ]) {
    expect(operation?.["x-symcrypt-runtime-refinements"]).toEqual([
      organizationBillingAssignedSeatsRefinement,
    ]);
  }
});
