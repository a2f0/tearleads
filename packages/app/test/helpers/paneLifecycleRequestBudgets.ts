import { expect } from "bun:test";
import type { ProxiedApiRequestBudget } from "./proxiedApiRequestBudget";
import { documentSyncIntentCounts } from "./proxiedApiRequestMetrics";
import type { ProxiedApiRequest } from "./proxiedApiResponse";

// Measured 2026-11-10. These pin the current protocol, not an optimized target.
export const PANE_RESTART_BUDGET = {
  total: 23,
  byRequest: {
    "POST /auth/ws-ticket": 1,
    "GET /organization-memberships": 1,
    "GET /organizations/:organizationId/billing": 1,
    "POST /containers/parent-lanes/query": 2,
    "POST /containers/documents/query": 3,
    "GET /principals/organization/:organizationId/policy": 2,
    "GET /principals/history": 1,
    "GET /containers/:containerId/writer-projection": 3,
    "GET /documents/:documentId/writer-projection": 3,
    "POST /documents/:documentId/sync": 6,
  },
} satisfies ProxiedApiRequestBudget;

export const PANE_RECONNECT_BUDGET = {
  total: 22,
  byRequest: {
    "POST /auth/ws-ticket": 1,
    "GET /organization-memberships": 1,
    "POST /containers/parent-lanes/query": 4,
    "POST /containers/documents/query": 1,
    "GET /principals/organization/:organizationId/policy": 3,
    "GET /containers/:containerId/writer-projection": 1,
    "GET /documents/:documentId/writer-projection": 3,
    "POST /documents/:documentId/sync": 8,
  },
} satisfies ProxiedApiRequestBudget;

export const PANE_REMOTE_RECONNECT_BUDGET = {
  total: 30,
  byRequest: {
    ...PANE_RECONNECT_BUDGET.byRequest,
    "POST /containers/parent-lanes/query": 6,
    "POST /containers/documents/query": 2,
    "GET /principals/organization/:organizationId/policy": 5,
    "GET /containers/:containerId/writer-projection": 2,
    "GET /documents/:documentId/writer-projection": 4,
    "POST /documents/:documentId/sync": 9,
  },
} satisfies ProxiedApiRequestBudget;

function matchesRoute(request: ProxiedApiRequest, route: string): boolean {
  const actual = `${request.method} ${new URL(request.url).pathname}`.split(
    "/",
  );
  const template = route.split("/");
  return (
    actual.length === template.length &&
    template.every(
      (part, index) => part.startsWith(":") || part === actual[index],
    )
  );
}

export function expectLifecycleRequestBoundary(
  requests: readonly ProxiedApiRequest[],
  budget: ProxiedApiRequestBudget,
) {
  // The shared budget helper caps named routes but does not reject new routes.
  // Keep this a closed set: auth/register, auth/verify, history, or any mutation
  // absent from the phase budget must not hide inside its total headroom.
  expect(
    requests.filter(
      (request) =>
        !Object.keys(budget.byRequest ?? {}).some((route) =>
          matchesRoute(request, route),
        ),
    ),
  ).toEqual([]);
  expect(requests.every((request) => request.status === 200)).toBe(true);
  expect(documentSyncIntentCounts(requests).writeBearing).toBe(0);
  for (const route of [
    "POST /auth/ws-ticket",
    "GET /organization-memberships",
  ]) {
    expect(
      requests.filter((request) => matchesRoute(request, route)),
      route,
    ).toHaveLength(1);
  }
}
