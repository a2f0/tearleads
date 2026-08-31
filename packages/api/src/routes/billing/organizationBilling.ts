import { NativeSubscriptionStoreSchema } from "@symcrypt/validators/billing";
import {
  claimNativeOrganizationSubscriptionOperation,
  getOrganizationBillingHistoryOperation,
  getOrganizationBillingManagementUrlOperation,
  getOrganizationBillingOperation,
  getOrganizationNativePurchaseEligibilityOperation,
  operationRoutePath,
  startOrganizationTrialOperation,
} from "@symcrypt/validators/operation";
import { type Context, Hono } from "hono";
import type { RevenueCatApiDeps } from "../../billing/revenueCatApi";
import type { SessionEnv } from "../../middleware/session";
import {
  claimNativeOrganizationSubscription,
  getOrganizationBilling,
  getOrganizationBillingHistory,
  getOrganizationBillingManagementUrl,
  getOrganizationNativePurchaseEligibility,
  startOrganizationTrial,
} from "../../services/billing/organizationBilling";
import { OrganizationBillingProviderUnavailableError } from "../../services/billing/organizationBillingErrors";
import { pathParamsValidator } from "../../validators/pathParams";
import {
  type OrganizationsRouterDeps,
  toOrganizationManagerErrorResponse,
} from "../organizations/shared";

/**
 * Runs an organization-scoped billing handler with its boundary-validated
 * `organizationId` and the session user, then maps an
 * `OrganizationManagerError` to its HTTP response and rethrows anything else to
 * the central error handler. Keeps each billing route a single delegation.
 */
async function respondForOrganization<T extends object>(
  c: Context<SessionEnv>,
  organizationId: string,
  handle: (organizationId: string, sessionUserId: string) => Promise<T>,
): Promise<Response> {
  try {
    return c.json(await handle(organizationId, c.get("session").userId));
  } catch (error) {
    if (error instanceof OrganizationBillingProviderUnavailableError) {
      return c.json({ error: error.message }, error.status);
    }
    const response = toOrganizationManagerErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

interface OrganizationBillingRouteDeps extends OrganizationsRouterDeps {
  readonly revenueCat?: RevenueCatApiDeps;
}

function registerOrganizationBillingReadRoutes(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: OrganizationBillingRouteDeps,
) {
  route.on(
    getOrganizationBillingOperation.method,
    operationRoutePath(getOrganizationBillingOperation),
    requireAuth,
    pathParamsValidator(
      getOrganizationBillingOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      return respondForOrganization(c, organizationId, (id, sessionUserId) =>
        getOrganizationBilling(runtime, id, sessionUserId),
      );
    },
  );

  route.on(
    getOrganizationBillingHistoryOperation.method,
    operationRoutePath(getOrganizationBillingHistoryOperation),
    requireAuth,
    pathParamsValidator(
      getOrganizationBillingHistoryOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      return respondForOrganization(c, organizationId, (id, sessionUserId) =>
        getOrganizationBillingHistory(runtime, id, sessionUserId),
      );
    },
  );

  route.on(
    getOrganizationBillingManagementUrlOperation.method,
    operationRoutePath(getOrganizationBillingManagementUrlOperation),
    requireAuth,
    pathParamsValidator(
      getOrganizationBillingManagementUrlOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      return respondForOrganization(c, organizationId, (id, sessionUserId) =>
        getOrganizationBillingManagementUrl(runtime, id, sessionUserId),
      );
    },
  );

  route.on(
    getOrganizationNativePurchaseEligibilityOperation.method,
    operationRoutePath(getOrganizationNativePurchaseEligibilityOperation),
    requireAuth,
    pathParamsValidator(
      getOrganizationNativePurchaseEligibilityOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      return respondForOrganization(c, organizationId, (id, sessionUserId) =>
        getOrganizationNativePurchaseEligibility(runtime, id, sessionUserId),
      );
    },
  );
}

function registerOrganizationTrialRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: OrganizationBillingRouteDeps,
) {
  route.on(
    startOrganizationTrialOperation.method,
    operationRoutePath(startOrganizationTrialOperation),
    requireAuth,
    pathParamsValidator(
      startOrganizationTrialOperation.params,
      "Invalid organizationId",
    ),
    (c) => {
      const { organizationId } = c.req.valid("param");
      return respondForOrganization(c, organizationId, (id, sessionUserId) =>
        startOrganizationTrial(runtime, id, sessionUserId),
      );
    },
  );
}

function nativeClaimPathError(value: unknown): string {
  const store =
    typeof value === "object" && value !== null && "store" in value
      ? value.store
      : undefined;
  return NativeSubscriptionStoreSchema.safeParse(store).success
    ? "Invalid organizationId"
    : "Invalid native subscription store";
}

function registerNativeSubscriptionClaimRoute(
  route: Hono<SessionEnv>,
  { requireAuth, revenueCat, runtime }: OrganizationBillingRouteDeps,
) {
  route.on(
    claimNativeOrganizationSubscriptionOperation.method,
    operationRoutePath(claimNativeOrganizationSubscriptionOperation),
    requireAuth,
    pathParamsValidator(
      claimNativeOrganizationSubscriptionOperation.params,
      nativeClaimPathError,
    ),
    (c) => {
      const { organizationId, store } = c.req.valid("param");
      return respondForOrganization(c, organizationId, (id, sessionUserId) =>
        claimNativeOrganizationSubscription(
          runtime,
          id,
          sessionUserId,
          store,
          revenueCat,
        ),
      );
    },
  );
}

export function createOrganizationBillingRoute(
  deps: OrganizationBillingRouteDeps,
) {
  const route = new Hono<SessionEnv>();

  registerOrganizationBillingReadRoutes(route, deps);
  registerOrganizationTrialRoute(route, deps);
  registerNativeSubscriptionClaimRoute(route, deps);

  return route;
}
