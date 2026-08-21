import {
  billingWebhookWireHeaderKeys,
  operationRoutePath,
  receiveStripeWebhookOperation,
} from "@symcrypt/validators/operation";
import { Hono } from "hono";
import { RevenueCatAssociationError } from "../../billing/revenueCatStripeAssociation";
import { StripeApiError } from "../../billing/stripeApi";
import type { SessionEnv } from "../../middleware/session";
import {
  authenticateStripeWebhook,
  processAuthenticatedStripeWebhook,
} from "../../services/billing/stripeCheckout";
import { headersValidator } from "../../validators/headers";
import type { OrganizationsRouterDeps } from "../organizations/shared";

/**
 * Stripe webhook endpoint: authenticated by the `Stripe-Signature` header over
 * the raw body. Non-2xx responses ask Stripe to redeliver transient failures.
 */
export function createStripeWebhookRoute(
  runtime: OrganizationsRouterDeps["runtime"],
) {
  const route = new Hono<SessionEnv>();

  route.on(
    receiveStripeWebhookOperation.method,
    operationRoutePath(receiveStripeWebhookOperation),
    headersValidator(receiveStripeWebhookOperation.headers),
    async (c) => {
      const payload = await c.req.text();
      const headers = c.req.valid("header");
      const authentication = authenticateStripeWebhook({
        payload,
        signatureHeader: headers[billingWebhookWireHeaderKeys.stripeSignature],
      });
      if (authentication.status === "unconfigured") {
        console.error(
          "Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not configured",
        );
        return c.json({ error: "Webhook not configured" }, 503);
      }
      if (authentication.status === "unauthorized") {
        return c.json({ error: "Invalid signature" }, 401);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return c.json({ received: true, outcome: "ignored" });
      }
      const request = receiveStripeWebhookOperation.body.safeParse(parsed);
      if (!request.success) {
        return c.json({ received: true, outcome: "ignored" });
      }

      let outcome: Awaited<
        ReturnType<typeof processAuthenticatedStripeWebhook>
      >;
      try {
        outcome = await processAuthenticatedStripeWebhook(
          runtime,
          request.data,
        );
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
        case "retry":
          console.error(`Stripe webhook deferred: ${outcome.reason}`);
          return c.json({ error: outcome.reason }, 503);
        default:
          return c.json({ received: true, outcome: outcome.status });
      }
    },
  );

  return route;
}
