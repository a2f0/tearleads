export const ROOT_ORGANIZATION_TABS = [
  { id: "overview", label: "Overview" },
  { id: "billing", label: "Billing" },
  { id: "history", label: "History" },
  { id: "identities", label: "Identities" },
  { id: "data-usage", label: "Data Usage" },
] as const;
export type RootOrganizationTab = (typeof ROOT_ORGANIZATION_TABS)[number]["id"];
export type RootView = "menu" | "identities" | "organizations" | "reports";
export type RootRoute =
  | { readonly view: "menu" }
  | { readonly view: "reports" }
  | {
      readonly userId: string | null;
      readonly view: "identities";
      readonly returnOrganizationId?: string;
    }
  | {
      readonly organizationId: string | null;
      readonly view: "organizations";
      readonly tab?: RootOrganizationTab;
      readonly returnView?: "reports";
    };
export const MENU_ROOT_ROUTE: RootRoute = { view: "menu" };
export const IDENTITIES_ROOT_ROUTE: RootRoute = {
  userId: null,
  view: "identities",
};
export const ORGANIZATIONS_ROOT_ROUTE: RootRoute = {
  organizationId: null,
  view: "organizations",
};

export function parseRootRouteSegments(
  pathSegments: ReadonlyArray<string>,
): RootRoute {
  const [view, id, returnView, returnId] = pathSegments;
  if (view === "identities")
    return {
      userId: id || null,
      view,
      ...(id && returnView === "organizations" && returnId
        ? { returnOrganizationId: returnId }
        : {}),
    };
  if (view === "reports") return { view };
  if (view === "organizations") {
    const tab = ROOT_ORGANIZATION_TABS.find((tab) => tab.id === returnView)?.id;
    return {
      organizationId: id || null,
      view,
      ...(id && tab ? { tab } : {}),
      ...(id && returnId === "reports"
        ? { returnView: "reports" as const }
        : {}),
    };
  }
  return MENU_ROOT_ROUTE;
}
export function formatRootRouteSegments(
  route: RootRoute,
): ReadonlyArray<string> {
  if (route.view === "menu") return [];
  if (route.view === "reports") return [route.view];
  if (route.view === "organizations")
    return route.organizationId === null
      ? [route.view]
      : [
          route.view,
          route.organizationId,
          ...(route.tab || route.returnView ? [route.tab ?? "overview"] : []),
          ...(route.returnView ? [route.returnView] : []),
        ];
  if (route.userId === null) return [route.view];
  return [
    route.view,
    route.userId,
    ...(route.returnOrganizationId
      ? ["organizations", route.returnOrganizationId]
      : []),
  ];
}
export function rootRouteForView(view: RootView): RootRoute {
  if (view === "reports") return { view };
  if (view === "organizations") return ORGANIZATIONS_ROOT_ROUTE;
  return view === "identities" ? IDENTITIES_ROOT_ROUTE : MENU_ROOT_ROUTE;
}
