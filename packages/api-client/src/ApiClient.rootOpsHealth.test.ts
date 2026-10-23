import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const empty = { rows: [], truncated: false };
const report = {
  generatedAt: "2026-10-22T00:00:00.000Z",
  seatSync: {
    rows: [
      {
        appliedRevision: 3,
        attemptCount: 2,
        conditions: ["failing" as const],
        desiredRevision: 4,
        lastError: "Stripe rejected the quantity",
        lastSyncedAt: null,
        leaseExpiresAt: null,
        nextAttemptAt: "2026-10-22T00:30:00.000Z",
        organizationId: "11111111-1111-4111-8111-111111111111",
      },
    ],
    truncated: true,
  },
  trialExpiry: empty,
  purges: empty,
  trialsEnding: empty,
  purgesDue: empty,
};

testApiClient("root ops-health transport decodes the report", async () => {
  server.use(
    http.get(`${apiBaseUrl}/root/reports/ops-health`, () =>
      HttpResponse.json(report),
    ),
  );
  const client = new ApiClient(apiBaseUrl);
  expect(await client.getRootOpsHealthReportResult()).toEqual({
    ok: true,
    data: report,
  });
});

testApiClient(
  "root ops-health transport rejects unknown conditions",
  async () => {
    server.use(
      http.get(`${apiBaseUrl}/root/reports/ops-health`, () =>
        HttpResponse.json({
          ...report,
          seatSync: {
            rows: [{ ...report.seatSync.rows[0], conditions: ["unknown"] }],
            truncated: false,
          },
        }),
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    expect((await client.getRootOpsHealthReportResult()).ok).toBe(false);
  },
);
