import { createHash, timingSafeEqual } from "node:crypto";
import {
  billingWebhookWireHeaderKeys,
  operationRoutePath,
  type RevenueCatWebhookHeaders,
  receiveRevenueCatWebhookOperation,
} from "@symcrypt/validators/operation";
import type { RevenueCatWebhookRequest } from "@symcrypt/validators/request";
import { Hono, type MiddlewareHandler } from "hono";
import { readRevenueCatWebhookAuthToken } from "../../billing/revenuecatWebhook";
import type { SessionEnv } from "../../middleware/session";
import { processRevenueCatWebhook } from "../../services/billing/revenuecatWebhook";
import type { ApiServiceRuntime } from "../../services/runtime";
import { headersValidator } from "../../validators/headers";

/**
 * Constant-time comparison of the presented `Authorization` header against the
 * configured shared secret. Both sides are SHA-256 hashed first so the compared
 * buffers are always the same fixed length: this avoids `timingSafeEqual`
 * throwing on a length mismatch and, more importantly, removes the timing
 * side-channel that a raw length check would leak about the secret's length.
 */
function authorizationMatches(
  presented: string | undefined,
  expected: string,
): boolean {
  if (!presented) {
    return false;
  }
  const presentedHash = createHash("sha256").update(presented).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(presentedHash, expectedHash);
}

function requireRevenueCatAuthorization(): MiddlewareHandler<
  SessionEnv,
  string,
  { out: { header: RevenueCatWebhookHeaders } }
> {
  return async (c, next) => {
    const expected = readRevenueCatWebhookAuthToken();
    if (!expected) {
      console.error(
        "RevenueCat webhook rejected: REVENUECAT_WEBHOOK_AUTH_HEADER is not configured",
      );
      return c.json({ error: "Webhook not configured" }, 503);
    }
    const headers = c.req.valid("header");
    if (
      !authorizationMatches(
        headers[billingWebhookWireHeaderKeys.revenueCatAuthorization],
        expected,
      )
    ) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  };
}

function revenueCatWebhookRequestValidator(): MiddlewareHandler<
  SessionEnv,
  string,
  { out: { json: RevenueCatWebhookRequest } }
> {
  return async (c, next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const result = receiveRevenueCatWebhookOperation.body.safeParse(body);
    if (!result.success) {
      return c.json({ error: "Invalid webhook payload" }, 400);
    }
    c.req.addValidatedData("json", result.data);
    return next();
  };
}

/**
 * RevenueCat webhook endpoint. Unlike the rest of the billing router this is not
 * behind `requireAuth`: it is a server-to-server callback authenticated by the
 * shared secret RevenueCat sends in the `Authorization` header. It fails closed
 * when the secret is not configured.
 */
export function createRevenueCatWebhookRoute(runtime: ApiServiceRuntime) {
  const route = new Hono<SessionEnv>();

  route.on(
    receiveRevenueCatWebhookOperation.method,
    operationRoutePath(receiveRevenueCatWebhookOperation),
    headersValidator(receiveRevenueCatWebhookOperation.headers),
    requireRevenueCatAuthorization(),
    revenueCatWebhookRequestValidator(),
    async (c) => {
      const body = c.req.valid("json");
      const outcome = await processRevenueCatWebhook(runtime, body.event);
      if (outcome.status === "retry") {
        // Non-2xx so RevenueCat redelivers once the event can be attributed.
        console.error(`RevenueCat webhook deferred: ${outcome.reason}`);
        return c.json({ error: outcome.reason }, 503);
      }
      return c.json({ received: true, outcome: outcome.status });
    },
  );

  return route;
}
