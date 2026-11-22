export const ROOT_ORGANIZATION_TABS = [
  { id: "overview", label: "Overview" },
  { id: "billing", label: "Billing" },
  { id: "history", label: "History" },
  { id: "identities", label: "Identities" },
  { id: "data-usage", label: "Data Usage" },
] as const;
export type RootOrganizationTab = (typeof ROOT_ORGANIZATION_TABS)[number]["id"];
const ROOT_REPORT_IDS = [
  "ops-health",
  "revenuecat",
  "data-usage",
  "pending-deletion",
] as const;
export type RootReportId = (typeof ROOT_REPORT_IDS)[number];
function parseRootReportId(segment: string | undefined): RootReportId | null {
  return ROOT_REPORT_IDS.find((id) => id === segment) ?? null;
}
export type RootView =
  | "menu"
  | "identities"
  | "organizations"
  | "reports"
  | "audit";
type RootReportsRoute = {
  readonly reportId: RootReportId | null;
  readonly view: "reports";
};
type RootAuditRoute = {
  readonly subjectId: string | null;
  readonly view: "audit";
};
/**
 * A view a detail can return to: a report (or the Reports list), or the audit
 * trail with the subject it was filtered to.
 */
export type RootReturnRoute = RootReportsRoute | RootAuditRoute;
/** Where a detail view's Back leads, when not to its own list. */
interface RootReturn {
  readonly returnTo?: RootReturnRoute;
}
export type RootRoute =
  | { readonly view: "menu" }
  | RootReturnRoute
  | ({
      readonly userId: string | null;
      readonly view: "identities";
      readonly returnOrganizationId?: string;
      /** The organization tab the identity was opened from; Identities if unset. */
      readonly returnOrganizationTab?: RootOrganizationTab;
    } & RootReturn)
  | ({
      readonly organizationId: string | null;
      readonly view: "organizations";
      readonly tab?: RootOrganizationTab;
    } & RootReturn);
export const MENU_ROOT_ROUTE: RootRoute = { view: "menu" };
export const IDENTITIES_ROOT_ROUTE: RootRoute = {
  userId: null,
  view: "identities",
};
export const ORGANIZATIONS_ROOT_ROUTE: RootRoute = {
  organizationId: null,
  view: "organizations",
};
export const REPORTS_ROOT_ROUTE: RootRoute = {
  reportId: null,
  view: "reports",
};
const AUDIT_ROOT_ROUTE: RootRoute = { subjectId: null, view: "audit" };

function parseRootReturnRoute(
  view: string | undefined,
  id: string | undefined,
): RootReturnRoute | null {
  if (view === "reports") return { reportId: parseRootReportId(id), view };
  if (view === "audit") return { subjectId: id || null, view };
  return null;
}
// A return is written after the detail's own segments, as the route it names.
function parseRootReturn(segments: ReadonlyArray<string>): RootReturn {
  const returnTo = parseRootReturnRoute(segments[0], segments[1]);
  return returnTo ? { returnTo } : {};
}
function formatRootReturn({ returnTo }: RootReturn): ReadonlyArray<string> {
  return returnTo ? formatRootRouteSegments(returnTo) : [];
}

function parseIdentitiesRoute(
  id: string | undefined,
  rest: ReadonlyArray<string>,
): RootRoute {
  const view = "identities";
  const [returnView, returnId, ...returnTail] = rest;
  if (!id) return { userId: null, view };
  if (returnView !== "organizations" || !returnId)
    return { userId: id, view, ...parseRootReturn(rest) };
  const [tabId, ...afterTab] = returnTail;
  const returnOrganizationTab = ROOT_ORGANIZATION_TABS.find(
    (tab) => tab.id === tabId,
  )?.id;
  return {
    userId: id,
    view,
    returnOrganizationId: returnId,
    ...(returnOrganizationTab ? { returnOrganizationTab } : {}),
    ...parseRootReturn(returnOrganizationTab ? afterTab : returnTail),
  };
}
export function parseRootRouteSegments(
  pathSegments: ReadonlyArray<string>,
): RootRoute {
  const [view, id, ...rest] = pathSegments;
  if (view === "identities") return parseIdentitiesRoute(id, rest);
  const returnRoute = parseRootReturnRoute(view, id);
  if (returnRoute) return returnRoute;
  if (view === "organizations") {
    const [tabId, ...returnTail] = rest;
    const tab = ROOT_ORGANIZATION_TABS.find((tab) => tab.id === tabId)?.id;
    if (!id) return { organizationId: null, view };
    return {
      organizationId: id,
      view,
      ...(tab ? { tab } : {}),
      ...parseRootReturn(returnTail),
    };
  }
  return MENU_ROOT_ROUTE;
}
/** A list view's segment, then the one item it has open, if any. */
function formatListRoute(
  view: RootView,
  id: string | null,
): ReadonlyArray<string> {
  return id === null ? [view] : [view, id];
}
export function formatRootRouteSegments(
  route: RootRoute,
): ReadonlyArray<string> {
  if (route.view === "menu") return [];
  if (route.view === "reports")
    return formatListRoute(route.view, route.reportId);
  if (route.view === "audit")
    return formatListRoute(route.view, route.subjectId);
  if (route.view === "organizations")
    return route.organizationId === null
      ? [route.view]
      : [
          route.view,
          route.organizationId,
          ...(route.tab || route.returnTo ? [route.tab ?? "overview"] : []),
          ...formatRootReturn(route),
        ];
  if (route.userId === null) return [route.view];
  return [
    route.view,
    route.userId,
    ...formatReturnOrganization(route),
    ...formatRootReturn(route),
  ];
}
function formatReturnOrganization(route: {
  readonly returnOrganizationId?: string;
  readonly returnOrganizationTab?: RootOrganizationTab;
}): ReadonlyArray<string> {
  if (!route.returnOrganizationId) return [];
  return [
    "organizations",
    route.returnOrganizationId,
    // The roster tab is the default return, so its URL stays short.
    ...(route.returnOrganizationTab &&
    route.returnOrganizationTab !== "identities"
      ? [route.returnOrganizationTab]
      : []),
  ];
}
export function rootRouteForView(view: RootView): RootRoute {
  if (view === "reports") return REPORTS_ROOT_ROUTE;
  if (view === "audit") return AUDIT_ROOT_ROUTE;
  if (view === "organizations") return ORGANIZATIONS_ROOT_ROUTE;
  return view === "identities" ? IDENTITIES_ROOT_ROUTE : MENU_ROOT_ROUTE;
}
