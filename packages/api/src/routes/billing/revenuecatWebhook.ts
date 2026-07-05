import { createHash, timingSafeEqual } from "node:crypto";
import { isRevenueCatWebhookRequest } from "@tearleads/validators/request";
import { Hono } from "hono";
import { readRevenueCatWebhookAuthToken } from "../../billing/revenuecatWebhook";
import type { SessionEnv } from "../../middleware/session";
import { processRevenueCatWebhook } from "../../services/billing/revenuecatWebhook";
import type { ApiServiceRuntime } from "../../services/runtime";

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

/**
 * RevenueCat webhook endpoint. Unlike the rest of the billing router this is not
 * behind `requireAuth`: it is a server-to-server callback authenticated by the
 * shared secret RevenueCat sends in the `Authorization` header. It fails closed
 * when the secret is not configured.
 */
export function createRevenueCatWebhookRoute(runtime: ApiServiceRuntime) {
  const route = new Hono<SessionEnv>();

  route.post("/billing/revenuecat/webhook", async (c) => {
    const expected = readRevenueCatWebhookAuthToken();
    if (!expected) {
      console.error(
        "RevenueCat webhook rejected: REVENUECAT_WEBHOOK_AUTH_HEADER is not configured",
      );
      return c.json({ error: "Webhook not configured" }, 503);
    }
    if (!authorizationMatches(c.req.header("Authorization"), expected)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (!isRevenueCatWebhookRequest(body)) {
      return c.json({ error: "Invalid webhook payload" }, 400);
    }

    const outcome = await processRevenueCatWebhook(runtime, body.event);
    return c.json({ received: true, outcome: outcome.status });
  });

  return route;
}
