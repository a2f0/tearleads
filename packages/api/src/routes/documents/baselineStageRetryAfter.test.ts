// Only an open that found the caller's own stage in use names a delay:
// the open operation is the one that declares `Retry-After`. A stage
// route's other 503, for a transaction the database chose to abort,
// carries none, on the open route as on the rest.
import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  getDocumentBaselineStageOperation,
  openDocumentBaselineStageOperation,
  operationResponseHeaderNames,
} from "@tearleads/validators/operation";
import { DOCUMENT_BASELINE_STAGE_BUSY_RETRY_AFTER_SECONDS } from "@tearleads/validators/util";
import { Hono } from "hono";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import type { SessionEnv } from "../../middleware/session";
import {
  DocumentBaselineStageBusyError,
  DocumentBaselineStageError,
} from "../../services/documents/documentBaselineStages";
import { toDocumentBaselineStageError } from "../../workflows/documents/baselineStages/errors";
import { createDocumentBaselineStagesRoute } from "./baselineStages";

const documentId = "11111111-1111-4111-8111-111111111111";
const baselineId = "22222222-2222-4222-8222-222222222222";

/** The stage routes over a database that aborts every transaction. */
function routesOverAbortingDatabase() {
  const aborting = new Proxy(db, {
    get(target, key) {
      if (key !== "transaction") return Reflect.get(target, key, target);
      return async () => {
        throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
      };
    },
  });
  const app = new Hono<SessionEnv>();
  app.route(
    "/",
    createDocumentBaselineStagesRoute({
      requireAuth: async (c, next) => {
        c.set("session", {
          createdAt: 0,
          fingerprint: "fingerprint-1",
          id: "session-1",
          ipAddresses: [],
          lastActiveAt: 0,
          lastActiveIp: null,
          twoFactorRequiredOrganizationIds: [],
          twoFactorVerified: false,
          userId: "33333333-3333-4333-8333-333333333333",
        });
        return next();
      },
      runtime: createServiceTestRuntime(aborting),
    }),
  );
  return app;
}

test("a stage route's 503 for an aborted transaction names no delay", async () => {
  const app = routesOverAbortingDatabase();
  const opened = await app.request(`/documents/${documentId}/baseline-stages`, {
    body: JSON.stringify({
      baselineId,
      contentKeyCommitment: "c".repeat(64),
      contentKeyEpoch: 1,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const read = await app.request(
    `/documents/${documentId}/baseline-stages/${baselineId}`,
  );
  for (const response of [opened, read]) {
    expect([response.status, await response.json()]).toEqual([
      503,
      { error: "Document mutation transaction conflicted; retry" },
    ]);
    expect(response.headers.get("retry-after")).toBeNull();
  }
});

test("only the busy refusal carries the delay the open operation declares", () => {
  const aborted = toDocumentBaselineStageError(
    Object.assign(new Error("deadlock detected"), { code: "40P01" }),
    () => new DocumentBaselineStageError("raced", 409),
  );
  expect(aborted).toBeInstanceOf(DocumentBaselineStageError);
  expect(aborted).not.toBeInstanceOf(DocumentBaselineStageBusyError);
  expect(aborted?.status).toBe(503);

  const busy = new DocumentBaselineStageBusyError();
  expect([busy.status, busy.retryAfterSeconds]).toEqual([
    503,
    DOCUMENT_BASELINE_STAGE_BUSY_RETRY_AFTER_SECONDS,
  ]);
  expect(
    operationResponseHeaderNames(openDocumentBaselineStageOperation, 503),
  ).toEqual(["retry-after"]);
  expect(
    operationResponseHeaderNames(getDocumentBaselineStageOperation, 503),
  ).toEqual([]);
});
