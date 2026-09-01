import {
  cancelStripeSubscriptionOperation,
  createStripeCheckoutOperation,
  createStripeCheckoutSessionOperation,
  createStripePortalOperation,
  getStripeCheckoutOptionsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { StripeApiError } from "../../billing/stripeApi";
import { type ApiCorsOrigins, readApiCorsOrigins } from "../../corsOrigins";
import type { SessionEnv } from "../../middleware/session";
import {
  cancelStripeSubscription,
  createStripeCheckout,
  createStripeCheckoutSession,
  createStripePortalUrl,
} from "../../services/billing/stripeCheckout";
import { getStripeCheckoutOptions } from "../../services/billing/stripeCheckoutOptions";
import { pathParamsValidator } from "../../validators/pathParams";
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
function returnUrlRequestValidator<Output extends { returnUrl: string }>(
  schema: SafeParseSchema<Output>,
  allowedOrigins: ApiCorsOrigins,
): MiddlewareHandler<SessionEnv, string, { out: { json: Output } }> {
  return async (c, next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const result = schema.safeParse(body);
    if (!result.success) {
      return c.json({ error: "Invalid returnUrl" }, 400);
    }
    const returnUrl = parseReturnUrl(result.data.returnUrl, allowedOrigins);
    if (!returnUrl) {
      return c.json({ error: "Invalid returnUrl" }, 400);
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
    pathParamsValidator(
      createStripeCheckoutOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      return respondForOrganization(c, organizationId, async (id, userId) => {
        const intent = await createStripeCheckout(runtime, id, userId);
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
  allowedOrigins: ApiCorsOrigins,
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
  allowedOrigins: ApiCorsOrigins,
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
      const { returnUrl } = c.req.valid("json");
      return respondForOrganization(c, organizationId, async (id, userId) => {
        const url = await createStripeCheckoutSession(
          runtime,
          id,
          userId,
          returnUrl,
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

export function createStripeCheckoutRoute(deps: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();
  const allowedOrigins = deps.corsOrigins ?? readApiCorsOrigins();

  registerStripeOptionsAndIntentRoutes(route, deps);
  registerStripePortalRoute(route, deps, allowedOrigins);
  registerStripeCheckoutSessionRoute(route, deps, allowedOrigins);
  registerStripeCancelRoute(route, deps);
  return route;
}
