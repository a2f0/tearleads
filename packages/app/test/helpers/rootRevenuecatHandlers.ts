import type {
  RootOrganizationRevenuecatEventsResponse,
  RootRevenuecatEventResponse,
  RootRevenuecatEventsReportResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  ROOT_TEST_IDENTITIES,
  ROOT_TEST_ORGANIZATION,
} from "./rootConsoleFixtures";

const organizationId = ROOT_TEST_ORGANIZATION.organization.organizationId;
const buyer = ROOT_TEST_IDENTITIES[1]?.userId ?? "";

function delivery(
  fields: Pick<
    RootRevenuecatEventResponse,
    "eventId" | "eventType" | "id" | "organizationId" | "outcome"
  > &
    Partial<RootRevenuecatEventResponse>,
): RootRevenuecatEventResponse {
  return {
    appUserId: buyer,
    createdAt: "2026-10-22T12:00:01.000Z",
    currency: "USD",
    environment: "PRODUCTION",
    eventTimestamp: "2026-10-22T12:00:00.000Z",
    expirationAt: "2026-11-22T12:00:00.000Z",
    originalTransactionId: "otx-1",
    periodType: "NORMAL",
    priceInPurchasedCurrencyMinor: 499,
    productId: "sync_monthly",
    purchasedAt: "2026-10-22T12:00:00.000Z",
    sourceOrganizationId: null,
    store: "APP_STORE",
    transactionId: "tx-1",
    ...fields,
  };
}

const REPORT: RootRevenuecatEventResponse[] = [
  delivery({
    eventId: "evt-unmatched",
    eventType: "INITIAL_PURCHASE",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizationId: null,
    outcome: "applied",
  }),
  delivery({
    appUserId: "$RCAnonymousID:1234",
    eventId: "evt-ignored",
    eventType: "RENEWAL",
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    organizationId,
    outcome: "ignored",
  }),
];

const ORGANIZATION: RootOrganizationRevenuecatEventsResponse["events"] = [
  {
    ...delivery({
      eventId: "evt-applied",
      eventType: "RENEWAL",
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      organizationId,
      outcome: "applied",
    }),
    role: "target",
  },
  {
    ...delivery({
      eventId: "evt-transfer",
      eventType: "TRANSFER",
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      organizationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      outcome: "applied",
      sourceOrganizationId: organizationId,
    }),
    role: "source",
  },
];

export const rootRevenuecatHandlers = [
  http.get<{ organizationId: string }>(
    "http://localhost:3001/root/organizations/:organizationId/revenuecat-events",
    ({ params }) =>
      HttpResponse.json<RootOrganizationRevenuecatEventsResponse>({
        events: params.organizationId === organizationId ? ORGANIZATION : [],
        nextCursor: null,
      }),
  ),
  http.get(
    "http://localhost:3001/root/reports/revenuecat-events",
    ({ request }) => {
      const disposition =
        new URL(request.url).searchParams.get("disposition") ?? "both";
      return HttpResponse.json<RootRevenuecatEventsReportResponse>({
        events: REPORT.filter(
          (event) =>
            (disposition !== "ignored" && event.organizationId === null) ||
            (disposition !== "unmatched" && event.outcome === "ignored"),
        ),
        nextCursor: null,
      });
    },
  ),
];
