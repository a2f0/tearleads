import { type Context, Hono } from "hono";
import { RevenueCatAssociationError } from "../../billing/revenueCatStripeAssociation";
import { StripeApiError } from "../../billing/stripeApi";
import { type ApiCorsOrigins, readApiCorsOrigins } from "../../corsOrigins";
import type { SessionEnv } from "../../middleware/session";
import {
  cancelStripeSubscription,
  createStripeCheckout,
  createStripeCheckoutSession,
  createStripePortalUrl,
  processStripeWebhook,
} from "../../services/billing/stripeCheckout";
import { getStripeCheckoutOptions } from "../../services/billing/stripeCheckoutOptions";
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
function parseReturnUrl(
  value: unknown,
  allowedOrigins: ApiCorsOrigins,
): string | null {
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
  if (allowedOrigins !== "*" && !allowedOrigins.includes(url.origin)) {
    return null;
  }
  return url.toString();
}

/**
 * Wraps a route that takes an origin-validated `returnUrl` body (the portal and
 * the hosted checkout session): parse the body, reject a missing/foreign URL
 * with 400, then run the org-admin-gated handler.
 */
function withReturnUrl(
  allowedOrigins: ApiCorsOrigins,
  respond: (
    c: Context<SessionEnv>,
    organizationId: string,
    sessionUserId: string,
    returnUrl: string,
  ) => Promise<Response>,
) {
  return async (c: Context<SessionEnv>) => {
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
      allowedOrigins,
    );
    if (!returnUrl) {
      return c.json({ error: "Invalid returnUrl" }, 400);
    }
    return respondForOrganization(c, (organizationId, sessionUserId) =>
      respond(c, organizationId, sessionUserId, returnUrl),
    );
  };
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
  corsOrigins,
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();
  // Prefer the origins the composition root resolved; fall back to the
  // environment only when constructed without them (e.g. a bare test app).
  const allowedOrigins = corsOrigins ?? readApiCorsOrigins();

  route.get(
    "/organizations/:organizationId/billing/stripe/options",
    requireAuth,
    (c) =>
      respondForOrganization(c, async (organizationId, sessionUserId) => {
        try {
          return c.json(
            await getStripeCheckoutOptions(
              runtime,
              organizationId,
              sessionUserId,
            ),
          );
        } catch (error) {
          if (error instanceof StripeApiError) {
            console.error("Stripe options lookup failed:", error.message);
            return c.json({ error: "Payment provider request failed" }, 502);
          }
          throw error;
        }
      }),
  );

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
    withReturnUrl(allowedOrigins, async (c, orgId, userId, returnUrl) => {
      const url = await createStripePortalUrl(
        runtime,
        orgId,
        userId,
        returnUrl,
      );
      return c.json({ portalUrl: url });
    }),
  );

  // The hosted-page alternative to the inline checkout. success/cancel URLs
  // are the same origin-validated `returnUrl` — an unvalidated value would be a
  // post-checkout open-redirect. Deliberately answers `200 { url: null }` (not
  // the inline `/checkout`'s 503) when unconfigured: the client validator
  // expects the `{ url }` shape, and a null just offers no external-pay link.
  route.post(
    "/organizations/:organizationId/billing/stripe/checkout-session",
    requireAuth,
    withReturnUrl(allowedOrigins, async (c, orgId, userId, returnUrl) => {
      const url = await createStripeCheckoutSession(
        runtime,
        orgId,
        userId,
        returnUrl,
      );
      return c.json({ url });
    }),
  );

  route.post(
    "/organizations/:organizationId/billing/stripe/cancel",
    requireAuth,
    (c) =>
      respondForOrganization(c, async (organizationId, sessionUserId) => {
        const result = await cancelStripeSubscription(
          runtime,
          organizationId,
          sessionUserId,
        );
        if (!result) {
          // Unconfigured, or no Stripe subscription bound to this org. Not an
          // error the admin can act on — the panel simply offers no cancel.
          return c.json({ error: "No cancellable subscription" }, 404);
        }
        return c.json({ cancelAt: result.cancelAt });
      }),
  );

  return route;
}

/**
 * Stripe webhook endpoint: authenticated by the `Stripe-Signature` header
 * over the RAW body (which is why the body is read as text, never re-parsed
 * before verification). Non-2xx responses make Stripe redeliver, which is the
 * retry mechanism for transient RevenueCat association failures.
 */
export function createStripeWebhookRoute(
  runtime: OrganizationsRouterDeps["runtime"],
) {
  const route = new Hono<SessionEnv>();

  route.post("/billing/stripe/webhook", async (c) => {
    let outcome: Awaited<ReturnType<typeof processStripeWebhook>>;
    try {
      outcome = await processStripeWebhook(runtime, {
        payload: await c.req.text(),
        signatureHeader: c.req.header("Stripe-Signature"),
      });
    } catch (error) {
      if (
        error instanceof StripeApiError ||
        error instanceof RevenueCatAssociationError
      ) {
        // Same semantics as the `retry` outcome: non-2xx so Stripe
        // redelivers, with an explicit log instead of a generic 500.
        console.error("Stripe webhook processing failed:", error.message);
        return c.json({ error: "Provider request failed" }, 503);
      }
      throw error;
    }
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
