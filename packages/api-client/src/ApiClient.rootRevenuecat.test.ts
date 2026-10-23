import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const delivery = {
  appUserId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-10-22T00:00:01.000Z",
  currency: "USD",
  environment: "PRODUCTION",
  eventId: "evt_1",
  eventTimestamp: "2026-10-22T00:00:00.000Z",
  eventType: "INITIAL_PURCHASE",
  expirationAt: "2026-11-22T00:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
  organizationId: null,
  originalTransactionId: "otx_1",
  outcome: "ignored",
  periodType: "NORMAL",
  priceInPurchasedCurrencyMinor: 499,
  productId: "sync_monthly",
  purchasedAt: "2026-10-22T00:00:00.000Z",
  sourceOrganizationId: null,
  store: "APP_STORE",
  transactionId: "tx_1",
};

testApiClient(
  "root RevenueCat transports send paging and the disposition filter",
  async () => {
    const seen: string[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/root/organizations/:organizationId/revenuecat-events`,
        ({ request }) => {
          seen.push(request.url);
          return HttpResponse.json({
            events: [
              { ...delivery, organizationId: ORGANIZATION_ID, role: "target" },
            ],
            nextCursor: "next",
          });
        },
      ),
      http.get(
        `${apiBaseUrl}/root/reports/revenuecat-events`,
        ({ request }) => {
          seen.push(request.url);
          return HttpResponse.json({ events: [delivery], nextCursor: null });
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);

    const organization =
      await client.listRootOrganizationRevenuecatEventsResult(ORGANIZATION_ID, {
        cursor: "abc",
        limit: 5,
      });
    expect(organization.ok && organization.data.events[0]?.role).toBe("target");
    const report = await client.listRootRevenuecatEventsReportResult({
      disposition: "unmatched",
    });
    expect(report).toEqual({
      ok: true,
      data: { events: [delivery], nextCursor: null },
    });
    expect(seen.map((url) => new URL(url).search)).toEqual([
      "?cursor=abc&limit=5",
      "?disposition=unmatched",
    ]);
  },
);

testApiClient("root RevenueCat transport rejects an unknown role", async () => {
  server.use(
    http.get(
      `${apiBaseUrl}/root/organizations/:organizationId/revenuecat-events`,
      () =>
        HttpResponse.json({
          events: [{ ...delivery, role: "witness" }],
          nextCursor: null,
        }),
    ),
  );
  const client = new ApiClient(apiBaseUrl);
  expect(
    (await client.listRootOrganizationRevenuecatEventsResult(ORGANIZATION_ID))
      .ok,
  ).toBe(false);
});
