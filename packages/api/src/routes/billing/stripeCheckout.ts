import {
  cancelStripeSubscriptionOperation,
  changeStripePlanOperation,
  createStripeCheckoutOperation,
  createStripeCheckoutSessionOperation,
  createStripePortalOperation,
  getStripeCheckoutOptionsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { readBillingReturnOrigins } from "../../billing/returnOrigins";
import { StripeApiError } from "../../billing/stripeApi";
import type { SessionEnv } from "../../middleware/session";
import {
  cancelStripeSubscription,
  createStripeCheckout,
  createStripePortalUrl,
} from "../../services/billing/stripeCheckout";
import { getStripeCheckoutOptions } from "../../services/billing/stripeCheckoutOptions";
import { createStripeCheckoutSession } from "../../services/billing/stripeHostedCheckout";
import { changeStripePlan } from "../../services/billing/stripePlanChange";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import { RequestBodyTooLargeError } from "../../validators/requestBodyTooLarge";
import type { SafeParseSchema } from "../../validators/schema";
import {
  type OrganizationsRouterDeps,
  toOrganizationManagerErrorResponse,
} from "../organizations/shared";

/**
 * Direct Stripe checkout routes (issue #1654). User-facing routes are authed
 * and admin-gated in the service; the webhook authenticates itself with
 * Stripe's signature instead and is mounted without `requireAuth`.
 */

/** Caller-supplied Stripe redirects must stay on approved billing origins. */
function parseReturnUrl(
  value: unknown,
  allowedOrigins: readonly string[],
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
  if (!allowedOrigins.includes(url.origin)) {
    return null;
  }
  return url.toString();
}

/**
 * Wraps a route that takes an origin-validated `returnUrl` body (the portal and
 * the hosted checkout session): parse the body, reject a missing/foreign URL
 * with 400, then any other invalid field, then run the org-admin-gated
 * handler.
 */
function returnUrlRequestValidator<Output extends { returnUrl: string }>(
  schema: SafeParseSchema<Output>,
  allowedOrigins: readonly string[],
): MiddlewareHandler<SessionEnv, string, { out: { json: Output } }> {
  return async (c, next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        throw error;
      }
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const returnUrl =
      typeof body === "object" &&
      body !== null &&
      "returnUrl" in body &&
      typeof body.returnUrl === "string"
        ? parseReturnUrl(body.returnUrl, allowedOrigins)
        : null;
    if (!returnUrl) {
      return c.json({ error: "Invalid returnUrl" }, 400);
    }
    const result = schema.safeParse(body);
    if (!result.success) {
      return c.json({ error: "Invalid request" }, 400);
    }
    c.req.addValidatedData("json", { ...result.data, returnUrl });
    return next();
  };
}

async function respondForOrganization(
  c: Context<SessionEnv>,
  organizationId: string,
  handle: (organizationId: string, sessionUserId: string) => Promise<Response>,
): Promise<Response> {
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

function registerStripeOptionsAndIntentRoutes(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: OrganizationsRouterDeps,
) {
  route.on(
    getStripeCheckoutOptionsOperation.method,
    operationRoutePath(getStripeCheckoutOptionsOperation),
    requireAuth,
    pathParamsValidator(
      getStripeCheckoutOptionsOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      return respondForOrganization(
        c,
        organizationId,
        async (id, sessionUserId) =>
          c.json(await getStripeCheckoutOptions(runtime, id, sessionUserId)),
      );
    },
  );

  route.on(
    createStripeCheckoutOperation.method,
    operationRoutePath(createStripeCheckoutOperation),
    requireAuth,
    jsonRequestValidator(createStripeCheckoutOperation.body),
    pathParamsValidator(
      createStripeCheckoutOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      const { priceId } = c.req.valid("json");
      return respondForOrganization(c, organizationId, async (id, userId) => {
        const intent = await createStripeCheckout(runtime, id, userId, priceId);
        if (!intent) {
          return c.json({ error: "Stripe checkout is not configured" }, 503);
        }
        return c.json(intent);
      });
    },
  );
}

function registerStripePortalRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: OrganizationsRouterDeps,
  allowedOrigins: readonly string[],
) {
  route.on(
    createStripePortalOperation.method,
    operationRoutePath(createStripePortalOperation),
    requireAuth,
    returnUrlRequestValidator(createStripePortalOperation.body, allowedOrigins),
    pathParamsValidator(
      createStripePortalOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      const { returnUrl } = c.req.valid("json");
      return respondForOrganization(c, organizationId, async (id, userId) => {
        const url = await createStripePortalUrl(runtime, id, userId, returnUrl);
        return c.json({ portalUrl: url });
      });
    },
  );
}

function registerStripeCheckoutSessionRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: OrganizationsRouterDeps,
  allowedOrigins: readonly string[],
) {
  route.on(
    createStripeCheckoutSessionOperation.method,
    operationRoutePath(createStripeCheckoutSessionOperation),
    requireAuth,
    returnUrlRequestValidator(
      createStripeCheckoutSessionOperation.body,
      allowedOrigins,
    ),
    pathParamsValidator(
      createStripeCheckoutSessionOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      const request = c.req.valid("json");
      return respondForOrganization(c, organizationId, async (id, userId) => {
        const url = await createStripeCheckoutSession(
          runtime,
          id,
          userId,
          request,
        );
        return c.json({ url });
      });
    },
  );
}

function registerStripeCancelRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: OrganizationsRouterDeps,
) {
  route.on(
    cancelStripeSubscriptionOperation.method,
    operationRoutePath(cancelStripeSubscriptionOperation),
    requireAuth,
    pathParamsValidator(
      cancelStripeSubscriptionOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      return respondForOrganization(c, organizationId, async (id, userId) => {
        const result = await cancelStripeSubscription(runtime, id, userId);
        if (!result) {
          // Unconfigured, or no Stripe subscription bound to this org. Not an
          // error the admin can act on — the panel simply offers no cancel.
          return c.json({ error: "No cancellable subscription" }, 404);
        }
        return c.json({ cancelAt: result.cancelAt });
      });
    },
  );
}

function registerStripePlanChangeRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: OrganizationsRouterDeps,
) {
  route.on(
    changeStripePlanOperation.method,
    operationRoutePath(changeStripePlanOperation),
    requireAuth,
    jsonRequestValidator(changeStripePlanOperation.body),
    pathParamsValidator(
      changeStripePlanOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      const request = c.req.valid("json");
      return respondForOrganization(c, organizationId, async (id, userId) => {
        const change = await changeStripePlan(runtime, id, userId, request);
        if (!change) {
          return c.json({ error: "Stripe is not configured" }, 503);
        }
        return c.json({ change });
      });
    },
  );
}

export function createStripeCheckoutRoute(deps: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();
  const allowedOrigins =
    deps.billingReturnOrigins ?? readBillingReturnOrigins();

  registerStripeOptionsAndIntentRoutes(route, deps);
  registerStripePortalRoute(route, deps, allowedOrigins);
  registerStripeCheckoutSessionRoute(route, deps, allowedOrigins);
  registerStripeCancelRoute(route, deps);
  registerStripePlanChangeRoute(route, deps);
  return route;
}
