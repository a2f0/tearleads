export type RootView = "menu" | "identities" | "organizations";
export type RootRoute =
  | { readonly view: "menu" }
  | {
      readonly userId: string | null;
      readonly view: "identities";
      readonly returnOrganizationId?: string;
    }
  | { readonly organizationId: string | null; readonly view: "organizations" };
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
  if (view === "organizations") return { organizationId: id || null, view };
  return MENU_ROOT_ROUTE;
}
export function formatRootRouteSegments(
  route: RootRoute,
): ReadonlyArray<string> {
  if (route.view === "menu") return [];
  if (route.view === "organizations")
    return route.organizationId === null
      ? [route.view]
      : [route.view, route.organizationId];
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
  if (view === "organizations") return ORGANIZATIONS_ROOT_ROUTE;
  return view === "identities" ? IDENTITIES_ROOT_ROUTE : MENU_ROOT_ROUTE;
}
