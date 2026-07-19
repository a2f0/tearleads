import { type Context, Hono } from "hono";
import { StripeApiError } from "../../billing/stripeApi";
import type { SessionEnv } from "../../middleware/session";
import { readApiCorsOrigins } from "../../routeApp";
import {
  createStripeCheckout,
  createStripePortalUrl,
  getStripeCheckoutOptions,
  processStripeWebhook,
} from "../../services/billing/stripeCheckout";
import type { ApiServiceRuntime } from "../../services/runtime";
import {
  type OrganizationsRouterDeps,
  parseOrganizationId,
  toOrganizationManagerErrorResponse,
} from "../organizations/shared";

/**
 * Direct Stripe checkout routes (issue #1654). User-facing routes are authed
 * and admin-gated in the service; the webhook authenticates itself with
 * Stripe's signature instead and is mounted without `requireAuth`.
 */

/**
 * The portal return target must be an http(s) URL on one of the app's own
 * origins (the CORS allowlist): `returnUrl` is caller-supplied, and Stripe's
 * portal redirects to it verbatim — accepting arbitrary origins would make
 * billing.stripe.com an open-redirect/phishing vector. The development
 * wildcard allowlist accepts any http(s) origin, matching the CORS policy.
 */
function parseReturnUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  const allowedOrigins = readApiCorsOrigins();
  if (allowedOrigins !== "*" && !allowedOrigins.includes(url.origin)) {
    return null;
  }
  return url.toString();
}

async function respondForOrganization(
  c: Context<SessionEnv>,
  handle: (organizationId: string, sessionUserId: string) => Promise<Response>,
): Promise<Response> {
  const organizationId = parseOrganizationId(c.req.param("organizationId"));
  if (!organizationId) {
    return c.json({ error: "Invalid organizationId" }, 400);
  }
  try {
    return await handle(organizationId, c.get("session").userId);
  } catch (error) {
    const response = toOrganizationManagerErrorResponse(error);
    if (response) {
      return response;
    }
    if (error instanceof StripeApiError) {
      console.error("Stripe checkout request failed:", error.message);
      return c.json({ error: "Payment provider request failed" }, 502);
    }
    throw error;
  }
}

export function createStripeCheckoutRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.get("/billing/stripe/options", requireAuth, async (c) => {
    try {
      return c.json(await getStripeCheckoutOptions());
    } catch (error) {
      if (error instanceof StripeApiError) {
        console.error("Stripe options lookup failed:", error.message);
        return c.json({ error: "Payment provider request failed" }, 502);
      }
      throw error;
    }
  });

  route.post(
    "/organizations/:organizationId/billing/stripe/checkout",
    requireAuth,
    (c) =>
      respondForOrganization(c, async (organizationId, sessionUserId) => {
        const intent = await createStripeCheckout(
          runtime,
          organizationId,
          sessionUserId,
        );
        if (!intent) {
          return c.json({ error: "Stripe checkout is not configured" }, 503);
        }
        return c.json(intent);
      }),
  );

  route.post(
    "/organizations/:organizationId/billing/stripe/portal",
    requireAuth,
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      const returnUrl = parseReturnUrl(
        typeof body === "object" && body !== null && "returnUrl" in body
          ? body.returnUrl
          : null,
      );
      if (!returnUrl) {
        return c.json({ error: "Invalid returnUrl" }, 400);
      }
      return respondForOrganization(
        c,
        async (organizationId, sessionUserId) => {
          const url = await createStripePortalUrl(
            runtime,
            organizationId,
            sessionUserId,
            returnUrl,
          );
          return c.json({ portalUrl: url });
        },
      );
    },
  );

  return route;
}

/**
 * Stripe webhook endpoint: authenticated by the `Stripe-Signature` header
 * over the RAW body (which is why the body is read as text, never re-parsed
 * before verification). Non-2xx responses make Stripe redeliver, which is the
 * retry mechanism for transient RevenueCat association failures.
 */
export function createStripeWebhookRoute(_runtime: ApiServiceRuntime) {
  const route = new Hono<SessionEnv>();

  route.post("/billing/stripe/webhook", async (c) => {
    const outcome = await processStripeWebhook({
      payload: await c.req.text(),
      signatureHeader: c.req.header("Stripe-Signature"),
    });
    switch (outcome.status) {
      case "unconfigured":
        console.error(
          "Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not configured",
        );
        return c.json({ error: "Webhook not configured" }, 503);
      case "unauthorized":
        return c.json({ error: "Invalid signature" }, 401);
      case "retry":
        // Non-2xx so Stripe redelivers once the configuration is restored.
        console.error(`Stripe webhook deferred: ${outcome.reason}`);
        return c.json({ error: outcome.reason }, 503);
      default:
        return c.json({ received: true, outcome: outcome.status });
    }
  });

  return route;
}
