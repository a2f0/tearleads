import type { RootOpsHealthReportResponse } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import { ROOT_TEST_ORGANIZATION } from "./rootConsoleFixtures";

const organizationId = ROOT_TEST_ORGANIZATION.organization.organizationId;

const ROOT_TEST_OPS_HEALTH: RootOpsHealthReportResponse = {
  generatedAt: "2026-10-22T12:00:00.000Z",
  seatSync: {
    rows: [
      {
        appliedRevision: 3,
        attemptCount: 4,
        conditions: ["failing", "leaseExpired"],
        desiredRevision: 5,
        lastError: "Stripe rejected the quantity",
        lastSyncedAt: null,
        leaseExpiresAt: "2026-10-22T11:55:00.000Z",
        nextAttemptAt: "2026-10-22T12:10:00.000Z",
        organizationId,
      },
    ],
    truncated: true,
  },
  trialExpiry: {
    rows: [
      {
        attemptCount: 8,
        lastError: "seat snapshot failed",
        nextAttemptAt: "2026-10-22T13:00:00.000Z",
        organizationId: "66666666-6666-4666-8666-666666666666",
        requiresAttention: true,
        trialEndsAt: "2026-10-21T12:00:00.000Z",
      },
    ],
    truncated: false,
  },
  purges: {
    rows: [
      {
        organizationId: "77777777-7777-4777-8777-777777777777",
        purgeAfter: "2026-10-20T12:00:00.000Z",
        purgeStartedAt: "2026-10-22T11:00:00.000Z",
        status: "deleting",
      },
    ],
    truncated: false,
  },
  trialsEnding: { rows: [], truncated: false },
  purgesDue: { rows: [], truncated: false },
};

export const rootOpsHealthHandlers = [
  http.get("http://localhost:3001/root/reports/ops-health", () =>
    HttpResponse.json(ROOT_TEST_OPS_HEALTH),
  ),
];
