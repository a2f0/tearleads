import { type Context, Hono } from "hono";
import { StripeApiError } from "../../billing/stripeApi";
import type { SessionEnv } from "../../middleware/session";
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
 * Only an http(s) URL may be handed to Stripe as the portal return target —
 * anything else (e.g. a javascript: URL) must not round-trip back to a
 * browser redirect.
 */
function parseReturnUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
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
      default:
        return c.json({ received: true, outcome: outcome.status });
    }
  });

  return route;
}
