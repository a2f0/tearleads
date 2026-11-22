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
export type RootRoute =
  | { readonly view: "menu" }
  | { readonly reportId: RootReportId | null; readonly view: "reports" }
  | { readonly subjectId: string | null; readonly view: "audit" }
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
/**
 * Where a detail view's Back leads: the report it was opened from (or the
 * Reports list), or the audit trail with the subject it was filtered to.
 */
export interface RootReturn {
  readonly returnView?: "reports" | "audit";
  readonly returnReportId?: RootReportId;
  readonly returnSubjectId?: string;
}
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

function parseRootReturn(segments: ReadonlyArray<string>): RootReturn {
  const [returnView, returnId] = segments;
  if (returnView === "reports") {
    const returnReportId = parseRootReportId(returnId);
    return { returnView, ...(returnReportId ? { returnReportId } : {}) };
  }
  if (returnView !== "audit") return {};
  return { returnView, ...(returnId ? { returnSubjectId: returnId } : {}) };
}
function formatRootReturn(route: RootReturn): ReadonlyArray<string> {
  const returnId =
    route.returnView === "audit" ? route.returnSubjectId : route.returnReportId;
  if (!route.returnView) return [];
  return returnId ? [route.returnView, returnId] : [route.returnView];
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
  if (view === "reports") return { reportId: parseRootReportId(id), view };
  if (view === "audit") return { subjectId: id || null, view };
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
          ...(route.tab || route.returnView ? [route.tab ?? "overview"] : []),
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
