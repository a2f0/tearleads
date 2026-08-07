import { Hono } from "hono";
import { RevenueCatAssociationError } from "../../billing/revenueCatStripeAssociation";
import { StripeApiError } from "../../billing/stripeApi";
import type { SessionEnv } from "../../middleware/session";
import { processStripeWebhook } from "../../services/billing/stripeCheckout";
import type { OrganizationsRouterDeps } from "../organizations/shared";

/**
 * Stripe webhook endpoint: authenticated by the `Stripe-Signature` header over
 * the raw body. Non-2xx responses ask Stripe to redeliver transient failures.
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
        console.error(`Stripe webhook deferred: ${outcome.reason}`);
        return c.json({ error: outcome.reason }, 503);
      default:
        return c.json({ received: true, outcome: outcome.status });
    }
  });

  return route;
}
