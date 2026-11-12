import { createRouteApp } from "../../src/routeApp";
import type { RouteAppOverrides } from "../../src/routeAppDeps";
import { getDefaultApiServiceRuntime } from "../../src/services/runtime";
import { API_TEST_IDENTITY_TRUST_DOMAIN } from "./policyProjection";

/** HTTP listeners share the identity scope used by in-process registration. */
export function createIdentityBoundRouteApp(overrides: RouteAppOverrides = {}) {
  return createRouteApp({
    ...overrides,
    runtime: {
      ...(overrides.runtime ?? getDefaultApiServiceRuntime()),
      identityTrustDomain: API_TEST_IDENTITY_TRUST_DOMAIN,
    },
  });
}

export const identityBoundRouteApp = createIdentityBoundRouteApp();
